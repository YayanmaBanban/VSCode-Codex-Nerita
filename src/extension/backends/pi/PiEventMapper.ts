// PiのAssistant本文を既存のChatMessageへ変換し、思考・ツール通知は分離する。
import { randomUUID } from "node:crypto";
import type { ChatState } from "../../../shared/chatState";
import { nextTimelineOrder } from "../../session/timelineOrder";
import type { PiEvent } from "./PiRuntime";

/** 1回の送信中に複数のAssistantメッセージが生成される場合も区別する。 */
export class PiEventMapper {
	private messageId: string | undefined;
	error: string | undefined;
	aborted = false;

	/** 差分通知の累積本文を使い、確定通知との重複を避ける。 */
	apply(event: PiEvent, state: ChatState): Partial<ChatState> | undefined {
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
			order: existing?.order ?? nextTimelineOrder(state),
		};
		if (finished) {
			if (event.message.stopReason === "error") {
				this.error =
					event.message.errorMessage ||
					"Piの応答取得に失敗しました。";
			}
			this.aborted ||= event.message.stopReason === "aborted";
			this.messageId = undefined;
		}
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
}
