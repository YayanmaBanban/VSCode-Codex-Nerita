// 組み込みの検索・コード実行を、会話の許可済みツールと Host の寿命へ限定する。

import type {
	ExtensionAPI,
	ExtensionFactory,
	ExtensionToolContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { approvePiTool, type PiAuthorize } from "./PiApprovedTools";
import type { SecretAuthBackend } from "../../credentials/SecretAuthBackend";
import type { AgentAccessPolicy } from "../../security/AgentAccessPolicy";
import {
	privateFeatureValue,
	abortableFeatureApproval,
} from "./PiFeatureSafety";

/** MCP の接続状態と独立した、ユーザーによる機能の選択。 */
export type PiToolFeatures = {
	codemode?: boolean | undefined;
	toolSearch?: boolean | undefined;
	allowedTools?: string[] | undefined;
	registry?: Set<string>;
	secrets?: () => Promise<readonly string[]>;
	protect?: <T>(value: T) => T;
	mcpBackend?: () => Promise<SecretAuthBackend>;
};

/** 許可されていないツールは、定義の登録・検索・有効化のいずれでも公開しない。 */
export function piToolPermitted(
	name: string,
	features: PiToolFeatures,
): boolean {
	return !features.allowedTools || features.allowedTools.includes(name);
}

/** 検索が有効な場合だけ、通常ツールを検索で読み込む対象にする。 */
export function piToolExposure(
	tool: ToolDefinition,
	features: PiToolFeatures,
): ToolDefinition {
	// 委譲用ツールは常に提示し、ツール検索を待たずに子の実行や管理を行えるようにする。
	if (["subagent", "subagent_job", "subagent_workflow"].includes(tool.name)) {
		return tool;
	}
	return features.toolSearch && (!tool.exposure || tool.exposure === "direct")
		? {
				...tool,
				exposure: "deferred",
				namespace: tool.namespace ?? {
					name: "host",
					description: "Tools enabled for this conversation",
				},
			}
		: tool;
}

/** SDK のファクトリーを維持し、メタデータと実行の境界を Host に合わせる。 */
export function guardedPiFeature(
	factory: ExtensionFactory,
	features: PiToolFeatures,
	cwd: string,
	authorize: PiAuthorize,
	policy: AgentAccessPolicy | undefined,
	lifetime: AbortSignal,
): ExtensionFactory {
	let secrets: readonly string[] = [];
	const guardedFeatures = {
		...features,
		secrets: async () => {
			secrets = (await features.secrets?.()) ?? [];
			return secrets;
		},
	};
	return (pi) =>
		factory({
			...pi,
			getAllTools: () =>
				pi
					.getAllTools()
					.filter((tool) => piToolPermitted(tool.name, features)),
			getActiveTools: () =>
				pi
					.getActiveTools()
					.filter((name) => piToolPermitted(name, features)),
			setActiveTools: (names) =>
				pi.setActiveTools(
					names.filter((name) => piToolPermitted(name, features)),
				),
			appendEntry: (type, data) =>
				pi.appendEntry(
					type,
					privateFeatureValue(data, secrets, features.protect),
				),
			registerTool: (tool) => {
				if (piToolPermitted(tool.name, features)) {
					pi.registerTool(
						guardFeatureTool(
							tool as unknown as ToolDefinition,
							guardedFeatures,
							cwd,
							authorize,
							policy,
							lifetime,
						),
					);
				}
			},
		} satisfies ExtensionAPI);
}

/** 承認待ちから計時し、コード内の設定で期限を延ばせないようにする。 */
function guardFeatureTool(
	tool: ToolDefinition,
	features: PiToolFeatures,
	cwd: string,
	authorize: PiAuthorize,
	policy: AgentAccessPolicy | undefined,
	lifetime: AbortSignal,
): ToolDefinition {
	const approved =
		tool.name === "codemode"
			? approvePiTool(
					tool,
					cwd,
					(request, signal) =>
						abortableFeatureApproval(
							authorize(request, signal),
							signal,
						),
					policy,
					lifetime,
				)
			: tool;
	return {
		...tool,
		defaultActive: true,
		executionMode: "sequential",
		async execute(id, params, signal, update, context) {
			const deadline = new AbortController();
			const timer = setTimeout(
				() =>
					deadline.abort(
						new Error("codemode の実行時間が60秒を超えました。"),
					),
				60000,
			);
			const combined = AbortSignal.any([
				lifetime,
				deadline.signal,
				...(signal ? [signal] : []),
			]);
			try {
				checkFeatureInput(tool.name, params);
				const secrets = (await features.secrets?.()) ?? [];
				const ctx = guardFeatureContext(
					context,
					features,
					combined,
					secrets,
				);
				return privateFeatureValue(
					await approved.execute(
						id,
						params,
						combined,
						update
							? (result) =>
									update(
										privateFeatureValue(
											result,
											secrets,
											features.protect,
										),
									)
							: undefined,
						ctx,
					),
					secrets,
					features.protect,
				);
			} finally {
				clearTimeout(timer);
			}
		},
	};
}

/** 許可リストと秘密値の検査をコードからの個別ツール実行にも適用する。 */
function guardFeatureContext(
	context: ExtensionToolContext,
	features: PiToolFeatures,
	combined: AbortSignal,
	secrets: readonly string[],
) {
	return {
		...context,
		tools: context.tools.filter((item) =>
			piToolPermitted(item.name, features),
		),
		executeTool: async (
			name: string,
			args: unknown,
			options?: Parameters<typeof context.executeTool>[2],
		) => {
			combined.throwIfAborted();
			if (!piToolPermitted(name, features)) {
				throw new Error("許可されていないツールです。");
			}
			const serialized = JSON.stringify(args) ?? "";
			if (
				(features.protect?.(serialized) !== undefined &&
					features.protect(serialized) !== serialized) ||
				secrets.some(
					(secret) => !!secret && serialized.includes(secret),
				) ||
				/"(?:authorization|password|secret|token|credential|api[_-]?key|private[_-]?key)"\s*:/i.test(
					serialized,
				)
			) {
				throw new Error("認証値を含む引数はコード実行から渡せません。");
			}
			return privateFeatureValue(
				await context.executeTool(name, args, {
					...options,
					signal: AbortSignal.any([
						combined,
						...(options?.signal ? [options.signal] : []),
					]),
				}),
				secrets,
				features.protect,
			);
		},
	};
}

/** 大きな入力を承認 UI や検索インデックスへ渡す前に拒否する。 */
function checkFeatureInput(name: string, params: unknown): void {
	if (Buffer.byteLength(JSON.stringify(params), "utf8") > 65536) {
		throw new Error("ツール入力は64 KiB以内にしてください。");
	}
	if (name !== "tool_search") {
		return;
	}
	const input = params as { query: string; limit?: number };
	if (input.query.length > 2048 || (input.limit ?? 8) > 16) {
		throw new Error("検索文字列は2048文字、件数は16件以内にしてください。");
	}
}
