// Pi のツール実行通知を、会話の実行 ID と順序を保った共通カードへ変換する。
import { textToolContent } from "@nerita/shared/toolContent";
import {
	isNonEmptyString,
	isNonZeroNumber,
	nonEmptyString,
} from "@nerita/shared/valuePredicates";
import type { ChatState, ToolSummary } from "@nerita/shared/chatState";
import { isRecord } from "@nerita/shared/validation";
import { nextTimelineOrder } from "../../session/timelineOrder";
import type { PiEvent } from "./PiRuntime";
import { piResultDisplay, piResultUnknown } from "./results/PiResultDisplay";
import { registerPiOutput } from "./results/PiToolOutput";

/** SDK の出力を、共通のテキスト表示形式へ揃える。 */
const textContent = textToolContent;

/** 終了済み項目や別ターンの同名 ID を変更せず、部分結果は累積値として置換する。 */
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
	if (isFinishedTool(existing) === true) {
		return;
	}
	const input: unknown = "args" in event ? event.args : existing?.rawInput;
	const args = isRecord(input) ? input : {};
	const file = toolPath(args, event.toolName);
	const label = toolLabel(event.toolName);
	const result: unknown = toolResult(event);
	const tool: ToolSummary = piToolSummary(
		event,
		state,
		existing,
		file,
		label,
		input,
		result,
	);
	registerPiOutput(
		tool,
		event.toolName,
		result,
		String(state.runId).startsWith("history:"),
	);
	return {
		tools: existing
			? state.tools.map((item) => (item === existing ? tool : item))
			: [...state.tools, tool],
	};
}

/** 終了済みカードへの遅い通知を排除する。 */
function isFinishedTool(existing: ToolSummary | undefined) {
	return (
		existing &&
		existing.status !== "pending" &&
		existing.status !== "in_progress"
	);
}

/** ツールの入力と累積結果からカードを組み立てる。 */
function piToolSummary(
	event: Extract<
		PiEvent,
		{
			type:
				| "tool_execution_start"
				| "tool_execution_update"
				| "tool_execution_end";
		}
	>,
	state: ChatState,
	existing: ToolSummary | undefined,
	file: string | undefined,
	label: string,
	input: unknown,
	result: unknown,
): ToolSummary {
	const kind = toolKind(event.toolName);
	return {
		id: event.toolCallId,
		...(isNonEmptyString(state.runId) ? { runId: state.runId } : {}),
		...toolParent(event, existing),
		...(isNonEmptyString(state.cwd) ? { cwd: state.cwd } : {}),
		order: existing?.order ?? nextTimelineOrder(state),
		title: toolTitle(existing, file, label, kind, input),
		kind,
		status: toolStatus(event, state.run),
		paths: toolPaths(existing, file),
		rawInput: input,
		...(result === undefined
			? {
					content: existing?.content ?? [],
					...(existing?.resultDisplay
						? { resultDisplay: existing.resultDisplay }
						: {}),
				}
			: piResultDisplay(result)),
	};
}

/** 終了通知で親 ID が省略された場合も、開始時の親子関係を保持する。 */
function toolParent(
	event: Extract<
		PiEvent,
		{
			type:
				| "tool_execution_start"
				| "tool_execution_update"
				| "tool_execution_end";
		}
	>,
	existing: ToolSummary | undefined,
) {
	const id = event.parentToolCallId ?? existing?.parentToolCallId;
	return isNonEmptyString(id) ? { parentToolCallId: id } : {};
}

/** 既存の対象パスを保持し、新規ツールのパスを補う。 */
function toolPaths(
	existing: ToolSummary | undefined,
	file: string | undefined,
): string[] {
	return existing?.paths ?? (isNonEmptyString(file) ? [file] : []);
}

/** 実行ツールは元のコマンドを見出しに使い、その他は既存の操作名を保持する。 */
function toolTitle(
	existing: ToolSummary | undefined,
	file: string | undefined,
	label: string,
	kind: string,
	input: unknown,
): string {
	if (
		kind === "execute" &&
		isRecord(input) &&
		typeof input.command === "string"
	) {
		return input.command;
	}
	return (
		existing?.title ??
		(isNonEmptyString(file) ? `${label}: ${file}` : label)
	);
}

/** `Stop` や通信障害で終了通知が来ない場合も、当該実行のカードを実行中のまま残さない。 */
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
					content: isNonZeroNumber(tool.content?.length)
						? tool.content
						: [
								textContent(
									cancelled
										? "処理を停止しました。"
										: (nonEmptyString(error) ??
												"ツールの完了通知を受信できませんでした。"),
								),
							],
				}
			: tool,
	);
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

/** 既知の Pi ツールを日本語の操作名へ変換する。 */
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

/** Pi のツール名を共通カードの種別へ変換する。 */
function toolKind(toolName: string): NonNullable<ToolSummary["kind"]> {
	if (toolName === "ls") {
		return "list";
	}
	if (toolName === "read") {
		return "read";
	}
	if (
		toolName === "powershell" ||
		toolName === "pwsh" ||
		toolName === "pnpm" ||
		toolName === "bash"
	) {
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
		if (piResultUnknown(event.result)) {
			return "unknown";
		}
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
