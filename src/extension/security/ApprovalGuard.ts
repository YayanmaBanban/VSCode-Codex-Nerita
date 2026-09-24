// 危険度判定とHuman Approvalをまとめ、実行処理はExecutorへ委譲する。
import {
	freezeToolCall,
	issueApprovedToolCall,
	type ToolCall,
} from "./ApprovedToolCall";
import type { AccessDecision } from "./AgentAccessPolicy";

/** Human Approvalの既存UIとStopの寿命を共有する。 */
export type ToolAuthorizer = (
	title: string,
	signal?: AbortSignal,
) => Promise<AbortSignal>;

/** 未知の拡張ツールもaskとし、shellの見た目から自動許可しない。 */
export function assessToolCall(call: ToolCall): AccessDecision {
	if (call.tool.startsWith("extension:")) {
		return {
			type: "deny",
			reason: "外部拡張のHost実行はアクセスpolicyを強制できないため拒否されました。",
		};
	}
	if (call.command && call.policy.command.mode !== "sandboxed") {
		return {
			type: "deny",
			reason: "Sandboxでのコマンド実行が許可されていません。",
		};
	}
	if (!call.command && (call.tool === "read" || call.tool === "ls")) {
		return { type: "allow" };
	}
	const text =
		typeof call.params.command === "string" ? call.params.command : "";
	const destructive =
		/remove-item|\brm\s+.*-[a-z]*r|git\s+(?:clean|reset\s+--hard)/i.test(
			text,
		);
	return {
		type: "ask",
		reason: destructive
			? "削除・履歴破棄を含む可能性のある操作です。"
			: "副作用を伴うツールは一回ごとの承認が必要です。",
	};
}

/** 承認画面とExecutorは同じsnapshotを利用する。 */
export async function approveToolCall(
	input: ToolCall,
	authorize: ToolAuthorizer,
	signal?: AbortSignal,
) {
	signal?.throwIfAborted();
	const call = freezeToolCall(input);
	const decision = assessToolCall(call);
	if (decision.type === "deny") {
		throw new Error(decision.reason);
	}
	const approvalSignal =
		decision.type === "ask"
			? await authorize(
					[
						`Pi: ${call.tool} の実行承認`,
						`作業フォルダー: ${call.cwd}`,
						JSON.stringify(call.params, null, 2),
						...approvalContext(call),
						decision.reason,
					].join("\n"),
					signal,
				)
			: (signal ?? new AbortController().signal);
	return issueApprovedToolCall(
		call,
		signal ? AbortSignal.any([signal, approvalSignal]) : approvalSignal,
	);
}

/** 信頼済み拡張をSandboxで制限したように表示しない。 */
function approvalContext(call: ToolCall): string[] {
	if (call.tool.startsWith("extension:")) {
		return ["実行範囲: 信頼済み拡張（Host権限・Sandbox外）"];
	}
	const context = [
		`実行範囲: ${call.command ? "Sandbox" : "ワークスペース内のファイル操作"}`,
		`書込み許可: ${call.policy.filesystem.writableRoots.join(", ")}`,
	];
	if (call.command) {
		context.push(
			`Shell network: ${call.policy.network.enabled ? "許可" : "禁止"}`,
		);
	}
	return context;
}
