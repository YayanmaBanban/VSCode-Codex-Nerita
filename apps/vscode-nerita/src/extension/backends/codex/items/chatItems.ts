// App Server のメッセージと基本ツール項目を、既存 UI の表示データへ変換する。
import type { CodexItem } from "../protocol/item";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import type { ChatState, ToolSummary } from "@nerita/shared/chatState";
import { isRecord } from "@nerita/shared/validation";
import { nextTimelineOrder } from "../../../session/timelineOrder";
import { activityItem, fileChanges } from "./activityItems";
import { agentItemPatch } from "./agentItems";

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
	value: CodexItem,
	completed: boolean,
): Partial<ChatState> {
	if (
		value.type === "subAgentActivity" ||
		value.type === "collabAgentToolCall"
	) {
		return agentItemPatch(state, value);
	}
	if (value.type === "agentMessage" || value.type === "plan") {
		if (typeof value.text !== "string") {
			throw new Error("Invalid agent message");
		}
		return messagePatch(state, value.id, value.text, false, !completed);
	}
	return toolPatch(state, value, value.id, completed);
}

/** 活動項目を既存のツールカードへ統合する。 */
function toolPatch(
	state: ChatState,
	value: Record<string, unknown>,
	itemId: string,
	completed: boolean,
): Partial<ChatState> {
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
		id: itemId,
		rawItem: value,
		runId: state.runId!,
		title: "ファイル変更",
		kind: "edit",
		paths: [],
		order: previous?.order ?? nextTimelineOrder(state),
		status: itemStatus(value, completed),
	};
	if (activity) {
		Object.assign(tool, activity);
	}
	updateCommandOrFiles(value, tool);
	retainStreamingOutput(tool, previous);
	return {
		tools: previous
			? state.tools.map((entry) => (entry === previous ? tool : entry))
			: [...state.tools, tool],
	};
}

/** 最終通知に本文がない場合も、停止直前までに受信した出力を保持する。 */
function retainStreamingOutput(
	tool: ToolSummary,
	previous: ToolSummary | undefined,
) {
	if (
		tool.kind === "execute" &&
		tool.rawOutput === undefined &&
		previous?.output
	) {
		tool.output = previous.output;
	}
}

/** コマンドとファイル変更の詳細をカードへ反映する。 */
function updateCommandOrFiles(
	value: Record<string, unknown>,
	tool: ToolSummary,
) {
	if (value.type === "commandExecution") {
		if (
			typeof value.command !== "string" ||
			typeof value.cwd !== "string"
		) {
			throw new Error("Invalid command item");
		}
		tool.title = commandTitle(value.command, value.commandActions);
		// 見出しを短縮しても、本文では実際の起動コマンドを確認できるようにする。
		tool.rawInput = { command: value.command };
		tool.cwd = value.cwd;
		tool.kind = "execute";
		if (typeof value.exitCode === "number") {
			tool.exitCode = value.exitCode;
		}
		if (typeof value.aggregatedOutput === "string") {
			tool.commandOutput = value.aggregatedOutput;
			tool.rawOutput = { formatted_output: value.aggregatedOutput };
		}
	} else if (value.type === "fileChange") {
		Object.assign(tool, fileChanges(value.changes));
	}
}

/** 解析済みの各操作を見出しへ使い、解析結果がない場合は起動コマンドから補う。 */
function commandTitle(command: string, actions: unknown): string {
	const commands = Array.isArray(actions)
		? actions.flatMap((action: unknown) =>
				isRecord(action) &&
				typeof action.command === "string" &&
				action.command.trim() !== ""
					? [powerShellBody(action.command)]
					: [],
			)
		: [];
	return commands.length > 0 ? commands.join("; ") : powerShellBody(command);
}

/** PowerShell の起動引数を表示から外す。実行用のコマンドには変更を加えない。 */
function powerShellBody(command: string): string {
	const invocation = /^(?:&\s+)?("[^"]+"|'[^']+'|\S+)\s([\s\S]*)$/u.exec(
		command.trim(),
	);
	if (!invocation) {
		return command;
	}
	const executable = invocation[1]!.replace(/^(['"])([\s\S]*)\1$/u, "$2");
	if (!/(?:^|[\\/])(?:powershell|pwsh)(?:\.exe)?$/iu.test(executable)) {
		return command;
	}
	const body = /(?:^|\s)-Command\s([\s\S]+)$/iu
		.exec(invocation[2]!)?.[1]
		?.trim();
	if (!isNonEmptyString(body)) {
		return command;
	}
	return body.replace(/^(['"])([\s\S]*)\1$/u, "$2");
}

/** 完了通知でのみ成否を確定し、途中の項目は実行中として扱う。 */
function itemStatus(
	value: Record<string, unknown>,
	completed: boolean,
): ToolSummary["status"] {
	if (completed) {
		if (
			(typeof value.status === "string" &&
				["failed", "declined"].includes(value.status)) ||
			value.success === false
		) {
			return "failed";
		}
		return "completed";
	}
	return "in_progress";
}
