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
		const text = resultText(part);
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
	const file = toolPath(args, event.toolName);
	const label = toolLabel(event.toolName);
	const result: unknown = toolResult(event);
	const tool: ToolSummary = {
		id: event.toolCallId,
		...(state.runId ? { runId: state.runId } : {}),
		...(state.cwd ? { cwd: state.cwd } : {}),
		order: existing?.order ?? nextTimelineOrder(state),
		title: existing?.title ?? (file ? `${label}: ${file}` : label),
		kind: toolKind(event.toolName),
		status: toolStatus(event, state.run),
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

/** テキストを取り出し、画像は内容を露出しない説明へ置き換える。 */
function resultText(part: Record<string, unknown>) {
	if (part.type === "text" && typeof part.text === "string") {
		return part.text;
	}
	if (part.type === "image") {
		return "画像を読み取りました。";
	}
	return undefined;
}

/** 明示パスを優先し、一覧ツールだけ現在のフォルダーを補う。 */
function toolPath(args: Record<string, unknown>, toolName: string) {
	if (typeof args.path === "string") {
		return args.path;
	}
	if (toolName === "ls") {
		return ".";
	}
	return undefined;
}

/** 既知のPiツールを日本語の操作名へ変換する。 */
function toolLabel(toolName: string) {
	if (toolName === "read") {
		return "ファイルを読む";
	}
	if (toolName === "ls") {
		return "フォルダーを確認";
	}
	if (toolName === "write") {
		return "ファイルを書き込む";
	}
	if (toolName === "edit") {
		return "ファイルを編集";
	}
	return toolName;
}

/** 完了結果または累積の途中結果を取り出す。 */
function toolResult(event: PiEvent): unknown {
	if (event.type === "tool_execution_end") {
		return event.result;
	}
	if (event.type === "tool_execution_update") {
		return event.partialResult;
	}
	return undefined;
}

/** Piのツール名を共通カードの種別へ変換する。 */
function toolKind(toolName: string): NonNullable<ToolSummary["kind"]> {
	if (toolName === "ls") {
		return "list";
	}
	if (toolName === "read") {
		return "read";
	}
	if (toolName === "powershell") {
		return "execute";
	}
	if (toolName === "write" || toolName === "edit") {
		return "edit";
	}
	return "other";
}

/** 終了通知の成否と停止待ちをカードの状態へ反映する。 */
function toolStatus(
	event: PiEvent,
	run: ChatState["run"],
): ToolSummary["status"] {
	if (event.type === "tool_execution_end") {
		if (event.isError) {
			if (run === "cancelling") {
				return "cancelled";
			}
			return "failed";
		}
		return "completed";
	}
	return "in_progress";
}
