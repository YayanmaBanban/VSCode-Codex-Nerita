// MCP 操作ごとに承認を求め、保存前に結果から秘密値を除去して出力サイズを制限する。
import { z } from "zod";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { isRecord } from "@nerita/shared/validation";
import { approvePiTool, type PiAuthorize } from "../PiApprovedTools";
import {
	abortableFeatureApproval,
	privateFeatureResult,
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
			// 承認待ちと要求自体はそれぞれ取り消せる。実行全体を中止と競合させると、送信後に返る結果不明の状態を受け取れない。
			return approved.execute(id, params, combined, update, context);
		},
	};
}

/** 結果の本文を優先して出力サイズを制限し、SDK の一時ファイル保存を使わない。 */
export function safeMcpResult(result: unknown, secrets: readonly string[]) {
	const raw = isRecord(result) ? result : {};
	const display = piResultDisplay(
		{ content: raw.content, structuredContent: raw },
		{ mcpEnvelope: true, secrets },
	);
	const content = (display.content ?? []).flatMap((item) => {
		if (item.type !== "content") {
			return [];
		}
		return [{ type: "text" as const, text: item.content.text }];
	});
	const structured = piStructuredDisplay(raw.structuredContent, secrets);
	let data: Awaited<
		ReturnType<ToolDefinition["execute"]>
	>["structuredContent"];
	if (raw.structuredContent !== undefined) {
		try {
			data = z.json().parse(JSON.parse(structured.text));
		} catch {
			data = { summary: structured.text, omitted: true };
		}
	}
	return privateFeatureResult(
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
