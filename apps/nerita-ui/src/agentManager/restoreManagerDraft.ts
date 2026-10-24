// 元の設定・最新の設定・下書きの3つを比較し、同じ項目に異なる変更がある場合だけ選択を求める。
import type { ManagerState } from "@nerita/shared/agentManager/messages";
import {
	draftChangeSchema,
	type DraftChange,
	type ManagerDraft,
} from "@nerita/shared/agentManager/draft";

/** 下書きの保存対象に対応する、最新の設定値を取り出す。 */
export function currentDraftChange(
	state: ManagerState,
	change: DraftChange,
): DraftChange | null {
	if (change.type === "agent") {
		const agent = state.agents.find((item) => item.id === change.agentId);
		return agent
			? { type: "agent", agentId: agent.id, edit: agent.edit }
			: null;
	}
	if (change.type === "defaults") {
		return { type: "defaults", defaults: state.piDefaults };
	}
	if (change.type === "handoff") {
		return {
			type: "handoff",
			backend: change.backend,
			config: state.handoff,
		};
	}
	return null;
}
/** 同じ末端項目が両側で変更された場合の比較値。 */
type Conflict = { path: string; current: unknown; draft: unknown };
/** JSON のプロパティ順によらず、値の一致を比較する。 */
function equal(a: unknown, b: unknown): boolean {
	if (a === b) {
		return true;
	}
	if (isRecord(a) && isRecord(b)) {
		const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
		return [...keys].every((key) => equal(a[key], b[key]));
	}
	return false;
}
/** 下書きの既知の構造を再帰的に走査するため、オブジェクトを絞り込む。 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** 同じ項目の異なる変更は、項目ごとの選択があるまで最新値を保持する。 */
export function restoreManagerDraft(
	state: ManagerState,
	draft: ManagerDraft,
	choices: Record<string, "current" | "draft"> = {},
) {
	const current = currentDraftChange(state, draft.change);
	const conflicts: Conflict[] = [];
	/** 片側だけの変更は採用し、双方の変更が異なる末端だけを競合にする。 */
	function merge(
		base: unknown,
		latest: unknown,
		edited: unknown,
		path: string,
	): unknown {
		if (equal(base, edited)) {
			return latest;
		}
		if (equal(base, latest) || equal(latest, edited)) {
			return edited;
		}
		if (isRecord(base) && isRecord(latest) && isRecord(edited)) {
			const result: Record<string, unknown> = {};
			for (const key of new Set([
				...Object.keys(base),
				...Object.keys(latest),
				...Object.keys(edited),
			])) {
				result[key] = merge(
					base[key],
					latest[key],
					edited[key],
					path !== "" ? `${path}.${key}` : key,
				);
			}
			return result;
		}
		conflicts.push({ path, current: latest, draft: edited });
		return choices[path] === "draft" ? edited : latest;
	}
	if (draft.change.type === "createAgent") {
		return { conflicts, change: draft.change, missing: false };
	}
	if (current === null) {
		return { conflicts, change: draft.change, missing: true };
	}
	const change = draftChangeSchema.parse(
		merge(draft.base, current, draft.change, ""),
	);
	return { conflicts, change, missing: false };
}
