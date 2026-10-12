// 子セッションのイベントを表示へ渡し、最後の応答本文と失敗状態を保持する。
import type { PiEvent } from "./PiRuntime";
import type { PiAgentViews } from "./PiAgentViews";

/** 後続の成功応答でも、それ以前のツール失敗や中断を取り消さない。 */
export class PiChildOutput {
	output = "";
	failed = false;
	/** 子の出力と活動通知を指定した子 ID へ結び付ける。 */
	constructor(
		private views: PiAgentViews,
		private id: string,
	) {}

	/** 最後のアシスタント本文は32768文字まで保持する。 */
	receive(event: PiEvent) {
		this.views.event(this.id, event);
		if (event.type === "tool_execution_end" && event.isError) {
			this.failed = true;
		}
		if (event.type !== "message_end") {
			return;
		}
		if (event.message.role !== "assistant") {
			return;
		}
		this.output = event.message.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n")
			.slice(0, 32768);
		this.failed ||= ["error", "aborted"].includes(event.message.stopReason);
	}
}
