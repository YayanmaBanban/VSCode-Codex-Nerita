// 検証済みの活動通知を順に反映し、完了済み項目への遅延更新を抑止する。
import type { ChatState, ToolSummary } from "@nerita/shared/chatState";
import { nextTimelineOrder } from "../../../session/timelineOrder";
import { textContent } from "./activityItems";
import { setToolOutputSource } from "../../../session/toolOutputSource";
import type { ActivityUpdate } from "./activityEvent";

/** 分割された推論の各セクションを独立して蓄積する。 */
export type ActivityStreams = Map<string, Map<string, string>>;

/** ターン ID と通知本文を入口で検証してから、既存カードへ反映する。 */
export function activityPatch(
	state: ChatState,
	update: ActivityUpdate,
	streams: ActivityStreams,
	completed: Set<string>,
): Partial<ChatState> {
	const id = update.id;
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
	updateActivityTool(tool, update, parts);
	return {
		tools: previous
			? state.tools.map((item) => (item === previous ? tool : item))
			: [...state.tools, tool],
	};
}

/** 判別子が保証するフィールドを読み、外部データの再検査は行わない。 */
function updateActivityTool(
	tool: ToolSummary,
	update: ActivityUpdate,
	parts: Map<string, string>,
) {
	switch (update.kind) {
		case "diff":
			tool.title = "ターン全体の差分";
			tool.kind = "edit";
			tool.content = [
				{ type: "unifiedDiff", path: "変更全体", diff: update.diff },
			];
			return;
		case "plan":
			tool.title = "実行計画";
			tool.kind = "think";
			tool.content = [
				textContent(
					update.plan
						.map((step) => `${step.status}: ${step.step}`)
						.join("\n"),
				),
			];
			return;
		case "changes":
			tool.paths = update.paths;
			tool.content = update.content;
			tool.title = "ファイル変更";
			tool.kind = "edit";
			return;
		case "stdin":
			tool.rawInput = { stdin: update.stdin };
			return;
		case "progress":
			tool.content = [textContent(update.message)];
			return;
		case "reasoning":
			updateReasoning(tool, update, parts);
			return;
		case "output":
			if (update.command) {
				tool.kind = "execute";
				setToolOutputSource(tool, { text: update.delta, delta: true });
			} else {
				parts.set("text", (parts.get("text") ?? "") + update.delta);
				tool.title = "ファイル変更";
				tool.content = [textContent(parts.get("text")!)];
			}
	}
}

/** 推論の同じセクションだけへ差分を蓄積し、追加通知では既存本文を消さない。 */
function updateReasoning(
	tool: ToolSummary,
	update: Extract<ActivityUpdate, { kind: "reasoning" }>,
	parts: Map<string, string>,
) {
	const key = `${update.section}:${update.index}`;
	if (!update.added) {
		parts.set(key, (parts.get(key) ?? "") + update.delta);
	} else if (!parts.has(key)) {
		parts.set(key, "");
	}
	tool.title = "推論";
	tool.kind = "think";
	tool.content = [textContent([...parts.values()].join("\n\n"))];
	return;
}
