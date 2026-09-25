// 保存された選択ブランチを再表示し、未完了ツールや承認を再実行しない。
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { initialState, type ChatState } from "../../../shared/chatState";
import { nextTimelineOrder } from "../../session/timelineOrder";
import { mapPiTool, finishPiTools } from "./PiToolMapper";

/** 保存履歴の本文とツール結果を表す。 */
type HistoryMessage = Extract<SessionEntry, { type: "message" }>["message"];

/** 本文・ツールの順序を復元し、新しい送信に過去の実行 ID を使わせない。 */
export function restorePiHistory(
	entries: SessionEntry[],
	cwd: string,
): Pick<ChatState, "messages" | "tools" | "sessionTitle"> {
	const state = { ...initialState(), cwd, runId: "history:initial" };
	let title: string | undefined;
	for (const entry of entries) {
		if (entry.type === "session_info" && entry.name?.trim()) {
			title = entry.name.trim();
		}
		if (entry.type !== "message") {
			continue;
		}
		const message = entry.message;
		if (message.role === "user") {
			state.tools = finishPiTools(state, true);
			state.runId = `history:${entry.id}`;
		}
		if (message.role === "user" || message.role === "assistant") {
			restoreChatMessage(message, state, entry);
		} else if (message.role === "toolResult") {
			// SDK は停止を `isError` と定型本文で保存するため、その形式だけを停止へ戻す。
			restoreToolResult(message, state);
		}
	}
	state.tools = finishPiTools(state, true);
	return {
		messages: state.messages,
		tools: state.tools,
		sessionTitle: historyTitle(title, state),
	};
}

/** 保存タイトルがない場合は最初の入力を会話名に使う。 */
function historyTitle(
	title: string | undefined,
	state: ChatState,
): string | null {
	return (
		title ||
		state.messages.find((m) => m.role === "user")?.text.slice(0, 120) ||
		"Pi"
	);
}

/** 保存されたツールの完了結果と停止状態を復元する。 */
function restoreToolResult(
	message: Extract<HistoryMessage, { role: "toolResult" }>,
	state: ChatState,
) {
	const resultText = message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
	const cancelled =
		message.isError &&
		(resultText === "Operation aborted" ||
			resultText === "This operation was aborted" ||
			/(?:^|\n)Command aborted$/.test(resultText));
	Object.assign(
		state,
		mapPiTool(
			{
				type: "tool_execution_end",
				toolCallId: message.toolCallId,
				toolName: message.toolName,
				result: message,
				isError: message.isError,
			},
			{ ...state, run: cancelled ? "cancelling" : "idle" },
		),
	);
}

/** 保存本文とツール呼び出しを順序どおり復元する。 */
function restoreChatMessage(
	message: Extract<HistoryMessage, { role: "user" | "assistant" }>,
	state: ChatState,
	entry: Extract<SessionEntry, { type: "message" }>,
) {
	const text =
		typeof message.content === "string"
			? message.content
			: message.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join("");
	if (text) {
		state.messages.push({
			id: entry.id,
			role: message.role,
			text,
			order: nextTimelineOrder(state),
			streaming: false,
		});
	}
	if (message.role === "assistant") {
		for (const part of message.content) {
			if (part.type !== "toolCall") {
				continue;
			}
			Object.assign(
				state,
				mapPiTool(
					{
						type: "tool_execution_start",
						toolCallId: part.id,
						toolName: part.name,
						args: part.arguments,
					},
					state,
				),
			);
		}
	}
}
