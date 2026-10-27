// 保存された選択ブランチを再表示し、未完了ツールや承認を再実行しない。
import {
	isNonEmptyString,
	nonEmptyString,
} from "@nerita/shared/valuePredicates";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { initialState, type ChatState } from "@nerita/shared/chatState";
import { nextTimelineOrder } from "../../session/timelineOrder";
import { mapPiTool, finishPiTools } from "./PiToolMapper";
import { restorePiNestedTools } from "./PiNestedHistory";
import { restorePiReferences } from "./PiReferenceHistory";
import { restorePiReview } from "./PiReviewHistory";

/** 保存履歴の本文とツール結果を表す。 */
type HistoryMessage = Extract<SessionEntry, { type: "message" }>["message"];

/** 本文・ツールの順序を復元し、新しい送信に過去の実行 ID を使わせない。 */
export function restorePiHistory(
	entries: SessionEntry[],
	cwd: string,
): Pick<ChatState, "messages" | "tools" | "sessionTitle"> {
	const state = { ...initialState(), cwd, runId: "history:initial" };
	let title: string | undefined;
	const byId = new Map<string | null, SessionEntry>(
		entries.map((entry) => [entry.id, entry]),
	);
	for (const entry of entries) {
		if (entry.type === "session_info") {
			const name = entry.name?.trim();
			if (isNonEmptyString(name)) {
				title = name;
			}
			continue;
		}
		if (entry.type !== "message") {
			restorePiReview(entry, state);
			continue;
		}
		const message = entry.message;
		if (message.role === "user") {
			state.tools = finishPiTools(state, true);
			state.runId = `history:${entry.id}`;
		}
		if (message.role === "user" || message.role === "assistant") {
			restoreChatMessage(message, state, entry, byId.get(entry.parentId));
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
		nonEmptyString(title) ??
		nonEmptyString(
			state.messages.find((m) => m.role === "user")?.text.slice(0, 120),
		) ??
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
	const abortedText =
		resultText === "Operation aborted" ||
		resultText === "This operation was aborted" ||
		/(?:^|\n)Command aborted$/.test(resultText);
	const cancelled = message.isError && abortedText;
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
	restorePiNestedTools(message, state);
}

/** 保存本文とツール呼び出しを順序どおり復元する。 */
function restoreChatMessage(
	message: Extract<HistoryMessage, { role: "user" | "assistant" }>,
	state: ChatState,
	entry: Extract<SessionEntry, { type: "message" }>,
	parent: SessionEntry | undefined,
) {
	const text =
		typeof message.content === "string"
			? message.content
			: message.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join("");
	if (text !== "") {
		const references =
			message.role === "user"
				? restorePiReferences(parent, text)
				: undefined;
		state.messages.push({
			id: entry.id,
			role: message.role,
			text,
			...(references ? { references } : {}),
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
