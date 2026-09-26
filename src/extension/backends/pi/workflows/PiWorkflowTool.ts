// ワークスペースの TOML だけを受け付け、検査と実行を同じコンパイル経路へ通す。
import { readFile, stat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { parseWorkflow } from "../../../../shared/workflows/definition";
import { compileWorkflow } from "../../../../shared/workflows/compiler";
import { containsPath } from "../../../security/AgentAccessPolicy";
import { WorkspacePathPolicy } from "../../../security/WorkspacePathPolicy";
import {
	approveToolCall,
	type ToolAuthorizer,
} from "../../../security/ApprovalGuard";
import { consumeApprovedToolCall } from "../../../security/ApprovedToolCall";
import { guardrailRegistry } from "../../../security/GuardrailRegistry";
import type { createPiSubagentTool } from "../PiSubagentTool";
import { loadWorkflowEngine } from "./PiWorkflowEngine";
import { PiWorkflowChildren } from "./PiWorkflowChildren";

const inputSchema = z
	.object({
		action: z.enum(["validate", "run"]),
		file: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.toml$/),
		async: z.boolean().default(false),
	})
	.strict();

/** 未導入環境では実行エンジンを取得せず、既存の単一子をそのまま使える。 */
export function createPiWorkflowRunner(
	packagePath: string | undefined,
	...args: Parameters<typeof createPiSubagentTool>
) {
	if (!packagePath) {
		return undefined;
	}
	const [
		definitions,
		children,
		policy,
		cwd,
		authorize,
		lifetime,
		views,
		jobs,
	] = args;
	if (!views || !jobs) {
		throw new Error("ワークフローのジョブ管理がありません。");
	}
	return async (
		callId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		model: Parameters<ToolDefinition["execute"]>[4]["model"],
		expectedText?: string,
	) => {
		const input = inputSchema.parse(params);
		const combined = AbortSignal.any([
			lifetime,
			guardrailRegistry.snapshot(
				policy.guardrailsRoot ?? cwd,
				policy.workspaceRoots,
			).signal,
			...(signal ? [signal] : []),
		]);
		const paths = new WorkspacePathPolicy(policy, cwd);
		const text = await readWorkflow(input.file, paths, authorize, combined);
		if (expectedText !== undefined && text !== expectedText) {
			throw new Error(
				"保存内容が変更されています。再読み込みしてください。",
			);
		}
		const definition = parseWorkflow(text);
		const script = compileWorkflow(definition);
		const engine = await loadWorkflowEngine(packagePath);
		const validation = engine.validateWorkflowScript(script);
		if (!validation.ok) {
			throw new Error(
				`生成スクリプトの検査に失敗しました: ${JSON.stringify(validation.errors)}`,
			);
		}
		combined.throwIfAborted();
		// Agent とモデルの検査は validate でも実施し、子や承認を作らない。
		const preflight = new PiWorkflowChildren(
			definition,
			definitions,
			model,
			children,
			views,
			jobs,
			policy,
			cwd,
			authorize,
			callId,
			combined,
		);
		if (input.action === "validate") {
			return {
				content: [{ type: "text" as const, text: script }],
				details: { ok: true, definition },
			};
		}
		await preflight.close();
		const id = views.start(
			callId,
			definition.name,
			`Workflow: ${input.file}`,
			cwd,
		);
		const done = jobs.submit(
			{
				id,
				parentId: views.parentId,
				status: "queued",
				background: input.async,
				context: "fresh",
			},
			combined,
			async (jobSignal) => {
				const abort = new AbortController();
				const runSignal = AbortSignal.any([
					jobSignal,
					abort.signal,
					AbortSignal.timeout(definition.limits.timeout_ms),
				]);
				const group = new PiWorkflowChildren(
					definition,
					definitions,
					model,
					children,
					views,
					jobs,
					policy,
					cwd,
					authorize,
					id,
					runSignal,
				);
				try {
					return await engine.runWorkflowScript({
						script,
						signal: runSignal,
						timeoutMs: definition.limits.timeout_ms,
						globalConcurrencyLimit:
							definition.limits.max_concurrency,
						launch: (key, values, childSignal) =>
							group.launch(key, values, childSignal),
						status: (key) => Promise.resolve(group.status(key)),
					});
				} finally {
					abort.abort();
					await group.close();
				}
			},
			false,
		);
		const result: unknown = input.async ? { jobId: id } : await done;
		return {
			content: [{ type: "text" as const, text: JSON.stringify(result) }],
			details: result,
		};
	};
}

/** リンク先もワークスペースと定義ディレクトリの両方に収め、通常の読取りガードを通す。 */
async function readWorkflow(
	file: string,
	paths: WorkspacePathPolicy,
	authorize: ToolAuthorizer,
	signal: AbortSignal,
) {
	const root = await paths.resolveWorkspace(".pi/workflows");
	const path = await paths.resolveWorkspace(join(".pi/workflows", file));
	if (!containsPath(root, path) || (await stat(path)).size > 262144) {
		throw new Error("定義ファイルの範囲またはサイズが不正です。");
	}
	const permit = await approveToolCall(
		{
			tool: "read",
			cwd: paths.cwd,
			policy: paths.policy,
			params: { path },
		},
		authorize,
		signal,
	);
	consumeApprovedToolCall(permit);
	const text = await readFile(path, "utf8");
	permit.signal.throwIfAborted();
	if ((await realpath(path)) !== path || text.length > 262144) {
		throw new Error("読取り中に定義ファイルが変更されました。");
	}
	return text;
}

/** モデルのツール呼出しも、エディタと同じ実行処理へ渡す。 */
export function createPiWorkflowTools(
	packagePath: string | undefined,
	...args: Parameters<typeof createPiSubagentTool>
): ToolDefinition[] {
	const run = createPiWorkflowRunner(packagePath, ...args);
	if (!run) {
		return [];
	}
	return [
		{
			name: "subagent_workflow",
			label: "Pi workflow",
			description:
				"Validate or run a TOML file in .pi/workflows. Supports async jobs, resume and fork. Raw JavaScript and external runners are not accepted.",
			parameters: z.toJSONSchema(inputSchema, { io: "input" }),
			execute: (callId, params, signal, _update, context) =>
				run(callId, params, signal, context.model),
		},
	];
}
