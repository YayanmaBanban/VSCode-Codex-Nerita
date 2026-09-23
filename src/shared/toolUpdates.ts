// カードの識別子をターンと組み合わせ、差分を既存の順序へ適用する。
import type { ToolSummary, ChatState } from "./chatState";
import type { HostMessage } from "./messages";

/** 配列置換とカード差分を共通の状態へ復元する。 */
export function applyStatePatch(
	current: ChatState,
	message: Extract<HostMessage, { type: "state/patch" }>,
): ChatState {
	return {
		...current,
		...message.patch,
		...(message.toolUpdates
			? { tools: applyToolUpdates(current.tools, message.toolUpdates) }
			: {}),
		revision: message.revision,
	};
}

/** 別ターンで再利用されたツールIDを区別する。 */
export function toolKey(tool: ToolSummary): string {
	return JSON.stringify([tool.runId ?? null, tool.id]);
}

/** 未変更カードの参照を保ち、新規カードは末尾へ追加する。 */
export function applyToolUpdates(
	tools: ToolSummary[],
	updates: ToolSummary[],
): ToolSummary[] {
	const pending = new Map(updates.map((tool) => [toolKey(tool), tool]));
	const result = tools.map((tool) => {
		const key = toolKey(tool);
		const updated = pending.get(key);
		pending.delete(key);
		return updated ?? tool;
	});
	return [...result, ...pending.values()];
}
