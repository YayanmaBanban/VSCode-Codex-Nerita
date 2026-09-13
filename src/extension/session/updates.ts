// ACP 通知を会話・ツール概要の差分に変換する。
import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { ChatState } from "../../shared/messages";
/** 現在の実行に関係する通知だけを表示用状態へ変換する。 */
export function updateState(
	state: ChatState,
	notification: SessionNotification,
): Partial<ChatState> {
	if (
		state.run !== "running" ||
		state.sessionId !== notification.sessionId ||
		!state.runId
	) {
		return {};
	}
	const update = notification.update;
	if (
		update.sessionUpdate === "agent_message_chunk" &&
		update.content.type === "text"
	) {
		const id = `${state.runId}:${update.messageId ?? "assistant"}`;
		const existing = state.messages.find((message) => message.id === id);
		const message = {
			id,
			role: "assistant" as const,
			text: (existing?.text ?? "") + update.content.text,
		};
		return {
			messages: existing
				? state.messages.map((m) => (m.id === id ? message : m))
				: [...state.messages, message],
		};
	}
	if (
		update.sessionUpdate === "tool_call" ||
		update.sessionUpdate === "tool_call_update"
	) {
		const existing = state.tools.find(
			(tool) => tool.id === update.toolCallId,
		);
		const paths = update.locations?.map((location) => location.path);
		const diffs = update.content?.flatMap((content) =>
			content.type === "diff" ? [content.path] : [],
		);
		const tool = {
			id: update.toolCallId,
			title: update.title ?? existing?.title ?? "ツール実行",
			status: update.status ?? existing?.status ?? "pending",
			paths:
				paths || diffs
					? [...new Set([...(paths ?? []), ...(diffs ?? [])])]
					: (existing?.paths ?? []),
		};
		return {
			tools: existing
				? state.tools.map((t) => (t.id === tool.id ? tool : t))
				: [...state.tools, tool],
		};
	}
	return {};
}
