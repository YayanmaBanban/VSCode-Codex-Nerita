// MCP 操作を個別承認へ通し、生結果を保存前に有限の安全な本文へ変換する。
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { isRecord } from "@nerita/shared/validation";
import { approvePiTool, type PiAuthorize } from "../PiApprovedTools";
import {
	abortableFeatureApproval,
	privateFeatureValue,
} from "../PiFeatureSafety";
import { piResultDisplay } from "../results/PiResultDisplay";
import { piStructuredDisplay } from "../results/PiStructuredDisplay";
import type { AgentAccessPolicy } from "../../../security/AgentAccessPolicy";

/** 同じ出所検査と実行期限を、直接・検索・コード内の呼出しへ適用する。 */
export function approvedMcpTool(
	tool: ToolDefinition,
	options: {
		cwd: string;
		policy: AgentAccessPolicy;
		authorize: PiAuthorize;
		lifetime: AbortSignal;
		check: () => Promise<void>;
		timeoutMs: number;
	},
): ToolDefinition {
	const approved = approvePiTool(
		tool,
		options.cwd,
		(request, signal) =>
			abortableFeatureApproval(
				options.authorize(request, signal),
				signal,
			),
		options.policy,
		options.lifetime,
		options.check,
	);
	return {
		...approved,
		async execute(id, params, signal, update, context) {
			if (Buffer.byteLength(JSON.stringify(params), "utf8") > 65536) {
				throw new Error("MCP の入力は64 KiB以内にしてください。");
			}
			const combined = AbortSignal.any([
				options.lifetime,
				AbortSignal.timeout(options.timeoutMs),
				...(signal ? [signal] : []),
			]);
			return abortableFeatureApproval(
				approved.execute(id, params, combined, update, context),
				combined,
			);
		},
	};
}

/** 本文優先と出力予算を適用し、SDK の一時ファイル保存を使わない。 */
export function safeMcpResult(result: unknown, secrets: readonly string[]) {
	const raw = isRecord(result) ? result : {};
	const display = piResultDisplay(
		{ content: raw.content, structuredContent: raw },
		{ mcpEnvelope: true, secrets },
	);
	const content = (display.content ?? []).flatMap((item) => {
		if (
			!isRecord(item) ||
			!isRecord(item.content) ||
			typeof item.content.text !== "string"
		) {
			return [];
		}
		return [{ type: "text" as const, text: item.content.text }];
	});
	const structured = piStructuredDisplay(raw.structuredContent, secrets);
	let data:
		| NonNullable<
				Awaited<
					ReturnType<ToolDefinition["execute"]>
				>["structuredContent"]
		  >
		| undefined;
	if (raw.structuredContent !== undefined) {
		try {
			data = JSON.parse(structured.text) as typeof data;
		} catch {
			data = { summary: structured.text, omitted: true };
		}
	}
	return privateFeatureValue(
		{
			content,
			structuredContent: {
				content,
				...(data === undefined ? {} : { structuredContent: data }),
				...(raw.isError === true ? { isError: true } : {}),
			},
			details: { resultDisplay: display.resultDisplay },
			...(raw.isError === true ? { isError: true } : {}),
		},
		secrets,
	);
}

/** リソース応答も構造化結果と同じ走査・文字列・秘密値の制限を受ける。 */
export function safeMcpResource(result: unknown, secrets: readonly string[]) {
	return safeMcpResult({ content: [], structuredContent: result }, secrets);
}
