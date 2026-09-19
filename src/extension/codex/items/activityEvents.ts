// 項目ごとの逐次出力を蓄積し、ターンIDを照合済みの通知だけを表示へ反映する。
import type { ChatState, ToolSummary } from "../../../shared/chatState";
import { isRecord } from "../../../shared/validation";
import { nextTimelineOrder } from "../../session/timelineOrder";
import { fileChanges, textContent } from "./activityItems";

/** 分割された推論の各セクションを独立して蓄積する。 */
export type ActivityStreams = Map<string, Map<string, string>>;
/** テキストのある通知を検証する。 */
function text(value: unknown): string {
	if (typeof value !== "string") {
		throw new Error("Invalid activity text");
	}
	return value;
}
/** コマンド出力、推論、計画、差分の通知を既存カードへ反映する。 */
export function activityPatch(
	state: ChatState,
	method: string,
	p: Record<string, unknown>,
	streams: ActivityStreams,
	completed: Set<string>,
): Partial<ChatState> {
	const synthetic = method.startsWith("turn/");
	const id = synthetic ? `turn:${method}` : text(p.itemId);
	if (completed.has(id)) {
		return {};
	}
	const previous = state.tools.find(
		(item) => item.id === id && item.runId === state.runId,
	);
	const tool: ToolSummary = previous
		? { ...previous }
		: {
				id,
				runId: state.runId!,
				title: "作業",
				paths: [],
				kind: "other",
				status: "in_progress",
				order: nextTimelineOrder(state),
			};
	const parts = streams.get(id) ?? new Map<string, string>();
	streams.set(id, parts);
	if (method === "turn/diff/updated") {
		tool.title = "ターン全体の差分";
		tool.kind = "edit";
		tool.content = [
			{ type: "unifiedDiff", path: "変更全体", diff: text(p.diff) },
		];
	} else if (method === "turn/plan/updated") {
		if (!Array.isArray(p.plan)) {
			throw new Error("Invalid plan");
		}
		tool.title = "実行計画";
		tool.kind = "think";
		tool.content = [
			textContent(
				p.plan
					.map((step: unknown) => {
						if (!isRecord(step)) {
							throw new Error("Invalid plan step");
						}
						return `${text(step.status)}: ${text(step.step)}`;
					})
					.join("\n"),
			),
		];
	} else if (method === "item/fileChange/patchUpdated") {
		Object.assign(tool, fileChanges(p.changes));
		tool.title = "ファイル変更";
		tool.kind = "edit";
	} else if (method === "item/commandExecution/terminalInteraction") {
		tool.rawInput = { stdin: text(p.stdin) };
	} else if (method === "item/mcpToolCall/progress") {
		tool.content = [textContent(text(p.message))];
	} else if (method.includes("reasoning")) {
		const index = p.summaryIndex ?? p.contentIndex;
		if (!Number.isSafeInteger(index) || Number(index) < 0) {
			throw new Error("Invalid reasoning index");
		}
		const key = `${method.includes("summary") ? "summary" : "content"}:${Number(index)}`;
		if (method.endsWith("summaryPartAdded")) {
			if (!parts.has(key)) {
				parts.set(key, "");
			}
		} else {
			parts.set(key, (parts.get(key) ?? "") + text(p.delta));
		}
		tool.title = "推論";
		tool.kind = "think";
		tool.content = [textContent([...parts.values()].join("\n\n"))];
	} else {
		parts.set("text", (parts.get("text") ?? "") + text(p.delta));
		if (method === "item/commandExecution/outputDelta") {
			tool.kind = "execute";
			tool.rawOutput = { formatted_output: parts.get("text") };
		} else {
			tool.title = method === "item/plan/delta" ? "計画" : "ファイル変更";
			tool.content = [textContent(parts.get("text")!)];
		}
	}
	return {
		tools: previous
			? state.tools.map((item) => (item === previous ? tool : item))
			: [...state.tools, tool],
	};
}
