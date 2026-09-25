// Pi のアシスタント本文とツール通知を、既存の会話タイムラインへ変換する。
import { randomUUID } from "node:crypto";
import type { ChatMessage, ChatState } from "../../../shared/chatState";
import { nextTimelineOrder } from "../../session/timelineOrder";
import type { PiEvent } from "./PiRuntime";
import { mapPiTool } from "./PiToolMapper";

/** 1回の送信中に複数のアシスタントメッセージが生成される場合も区別する。 */
export class PiEventMapper {
	private messageId: string | undefined;
	error: string | undefined;
	aborted = false;

	/** 差分通知の累積本文を使い、確定通知との重複を避ける。 */
	apply(event: PiEvent, state: ChatState): Partial<ChatState> | undefined {
		const tools = mapPiTool(event, state);
		if (tools) {
			return tools;
		}
		if (
			!["message_start", "message_update", "message_end"].includes(
				event.type,
			) ||
			!("message" in event) ||
			event.message.role !== "assistant"
		) {
			return;
		}
		if (event.type === "message_start" || !this.messageId) {
			this.messageId = randomUUID();
		}
		const text = event.message.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("");
		const finished = event.type === "message_end";
		const id = this.messageId;
		const existing = state.messages.find((message) => message.id === id);
		const message = {
			id,
			role: "assistant" as const,
			text,
			streaming: !finished,
			order: messageOrder(existing, state),
		};
		this.finishMessage(finished, event.message);
		if (!text && !existing) {
			return;
		}
		return {
			messages: existing
				? state.messages.map((item) =>
						item.id === id ? message : item,
					)
				: [...state.messages, message],
		};
	}

	/** 完了した応答のエラーと停止状態を保持する。 */
	private finishMessage(
		finished: boolean,
		message: Extract<
			Extract<PiEvent, { type: "message_end" }>["message"],
			{ role: "assistant" }
		>,
	): void {
		if (finished) {
			if (message.stopReason === "error") {
				this.error =
					message.errorMessage || "Piの応答取得に失敗しました。";
			}
			this.aborted ||= message.stopReason === "aborted";
			this.messageId = undefined;
		}
	}
}

/** 既存メッセージの順序を保持し、新規分だけ採番する。 */
function messageOrder(existing: ChatMessage | undefined, state: ChatState) {
	return existing?.order ?? nextTimelineOrder(state);
}
