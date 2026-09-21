// Piのツール実行通知を、会話の実行IDと順序を保った共通カードへ変換する。
import type { ChatState, ToolSummary } from "../../../shared/chatState";
import { isRecord } from "../../../shared/validation";
import { nextTimelineOrder } from "../../session/timelineOrder";
import type { PiEvent } from "./PiRuntime";

/** 本文だけを表示用へ渡し、画像のbase64やSDK内部情報をカードへ露出しない。 */
function resultContent(result: unknown): unknown[] {
	if (!isRecord(result) || !Array.isArray(result.content)) {
		return [];
	}
	return result.content.flatMap((part: unknown) => {
		if (!isRecord(part)) {
			return [];
		}
		const text =
			part.type === "text" && typeof part.text === "string"
				? part.text
				: part.type === "image"
					? "画像を読み取りました。"
					: undefined;
		return text === undefined ? [] : [textContent(text)];
	});
}

/** SDKの出力を、共通のテキスト表示形式へ揃える。 */
function textContent(text: string) {
	return { type: "content", content: { type: "text", text } };
}

/** 終了済み項目や別ターンの同名IDを変更せず、部分結果は累積値として置換する。 */
export function mapPiTool(
	event: PiEvent,
	state: ChatState,
): Partial<ChatState> | undefined {
	if (
		event.type !== "tool_execution_start" &&
		event.type !== "tool_execution_update" &&
		event.type !== "tool_execution_end"
	) {
		return;
	}
	const existing = state.tools.find(
		(tool) => tool.id === event.toolCallId && tool.runId === state.runId,
	);
	if (
		existing &&
		existing.status !== "pending" &&
		existing.status !== "in_progress"
	) {
		return;
	}
	const input: unknown = "args" in event ? event.args : existing?.rawInput;
	const args = isRecord(input) ? input : {};
	const file =
		typeof args.path === "string"
			? args.path
			: event.toolName === "ls"
				? "."
				: undefined;
	const label =
		event.toolName === "read"
			? "ファイルを読む"
			: event.toolName === "ls"
				? "フォルダーを確認"
				: event.toolName === "write"
					? "ファイルを書き込む"
					: event.toolName === "edit"
						? "ファイルを編集"
						: event.toolName;
	const result: unknown =
		event.type === "tool_execution_end"
			? event.result
			: event.type === "tool_execution_update"
				? event.partialResult
				: undefined;
	const tool: ToolSummary = {
		id: event.toolCallId,
		...(state.runId ? { runId: state.runId } : {}),
		...(state.cwd ? { cwd: state.cwd } : {}),
		order: existing?.order ?? nextTimelineOrder(state),
		title: existing?.title ?? (file ? `${label}: ${file}` : label),
		kind:
			event.toolName === "ls"
				? "list"
				: event.toolName === "read"
					? "read"
					: event.toolName === "powershell"
						? "execute"
						: event.toolName === "write" ||
							  event.toolName === "edit"
							? "edit"
							: "other",
		status:
			event.type === "tool_execution_end"
				? event.isError
					? state.run === "cancelling"
						? "cancelled"
						: "failed"
					: "completed"
				: "in_progress",
		paths: existing?.paths ?? (file ? [file] : []),
		rawInput: input,
		content:
			result === undefined
				? (existing?.content ?? [])
				: resultContent(result),
	};
	return {
		tools: existing
			? state.tools.map((item) => (item === existing ? tool : item))
			: [...state.tools, tool],
	};
}

/** Stopや通信障害で終了通知が来ない場合も、当該実行のカードを実行中のまま残さない。 */
export function finishPiTools(
	state: ChatState,
	cancelled: boolean,
	error?: string,
): ToolSummary[] {
	return state.tools.map((tool) =>
		tool.runId === state.runId &&
		(tool.status === "pending" || tool.status === "in_progress")
			? {
					...tool,
					status: cancelled ? "cancelled" : "failed",
					content: tool.content?.length
						? tool.content
						: [
								textContent(
									cancelled
										? "処理を停止しました。"
										: error ||
												"ツールの完了通知を受信できませんでした。",
								),
							],
				}
			: tool,
	);
}
