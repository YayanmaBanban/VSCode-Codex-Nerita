// 実行基盤の途中出力を Pi の更新イベントへ接続し、最終結果と Phase 19 の保存経路を維持する。
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ApprovedToolCall } from "../../security/ApprovedToolCall";
import type { SandboxCommandExecutor } from "../../runtime/SandboxCommandExecutor";

/** SDK の update は累積結果を要求するため、ストリームの断片を順番に合成する。 */
export function streamPiCommand(
	executor: SandboxCommandExecutor,
	approved: ApprovedToolCall,
	update: Parameters<ToolDefinition["execute"]>[3],
) {
	let partial = "";
	return executor.execute(approved, (_stream, text) => {
		partial += text;
		update?.({ content: [{ type: "text", text: partial }], details: {} });
	});
}
