// App Server のメッセージと基本ツール項目を、既存 UI の表示データへ変換する。
import type { ChatState, ToolSummary } from "../../shared/messages";
import { isRecord } from "../../shared/validation";
import { nextTimelineOrder } from "../session/timelineOrder";
import { activityItem, fileChanges } from "./activityItems";

/** 項目 ID ごとに本文を追加・確定し、完了本文を重複追加しない。 */
export function messagePatch(
	state: ChatState,
	itemId: string,
	text: string,
	append: boolean,
	streaming = append,
): Partial<ChatState> {
	const id = `${state.runId ?? ""}:${itemId}`;
	const existing = state.messages.find((item) => item.id === id);
	if (existing) {
		return {
			messages: state.messages.map((item) =>
				item.id === id
					? {
							...item,
							text: append ? item.text + text : text,
							streaming,
						}
					: item,
			),
		};
	}
	return {
		messages: [
			...state.messages,
			{
				id,
				role: "assistant",
				text,
				streaming,
				order: nextTimelineOrder(state),
			},
		],
	};
}
/** 承認に必要なコマンド・変更対象と、完了時の概要を表示する。 */
export function itemPatch(
	state: ChatState,
	value: unknown,
	completed: boolean,
): Partial<ChatState> {
	if (!isRecord(value) || typeof value.id !== "string") {
		throw new Error("Invalid item");
	}
	if (value.type === "agentMessage") {
		if (typeof value.text !== "string") {
			throw new Error("Invalid agent message");
		}
		return messagePatch(state, value.id, value.text, false, !completed);
	}
	const activity = activityItem(value);
	if (
		value.type !== "commandExecution" &&
		value.type !== "fileChange" &&
		!activity
	) {
		return {};
	}
	const previous = state.tools.find(
		(tool) => tool.id === value.id && tool.runId === state.runId,
	);
	const tool: ToolSummary = {
		id: value.id,
		rawItem: value,
		runId: state.runId!,
		title: "ファイル変更",
		kind: "edit",
		paths: [],
		order: previous?.order ?? nextTimelineOrder(state),
		status: completed
			? ["failed", "declined"].includes(String(value.status)) ||
				value.success === false
				? "failed"
				: "completed"
			: "in_progress",
	};
	if (activity) {
		Object.assign(tool, activity);
	}
	if (value.type === "commandExecution") {
		if (
			typeof value.command !== "string" ||
			typeof value.cwd !== "string"
		) {
			throw new Error("Invalid command item");
		}
		tool.title = value.command;
		tool.cwd = value.cwd;
		tool.kind = "execute";
		if (typeof value.aggregatedOutput === "string") {
			tool.rawOutput = { formatted_output: value.aggregatedOutput };
		}
	} else if (value.type === "fileChange") {
		Object.assign(tool, fileChanges(value.changes));
	}
	return {
		tools: previous
			? state.tools.map((entry) => (entry === previous ? tool : entry))
			: [...state.tools, tool],
	};
}
