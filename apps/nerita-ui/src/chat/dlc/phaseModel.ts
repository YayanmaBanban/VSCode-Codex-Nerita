// 工程の保存状態を変更せず、展開位置と表示用の集計を算出する。
import type { DlcProjection, DlcView } from "@nerita/shared/dlc/contracts";

export const phases = [
	"Initialization",
	"Ideation",
	"Inception",
	"Construction",
	"Operation",
];
export const statusLabels = {
	pending: "未着手",
	active: "実行中",
	"awaiting-approval": "承認待ち",
	revising: "修正中",
	completed: "完了",
	skipped: "対象外",
};
export const selectionLabels = {
	execute: "対象",
	skip: "対象外",
	undetermined: "未確定",
};

/** 初回は現在の工程を開く。利用者の展開位置があればそれを優先する。 */
export function currentPhase(selected: DlcProjection | null): number {
	const next = selected?.stages.find(
		(stage) => !["completed", "skipped"].includes(stage.status),
	);
	return next ? Number(next.id.split(".")[0]) : 0;
}

/** Phase の工程状態から表示用の要約を返す。実行可否の判断には工程の状態を直接使う。 */
export function phaseStatus(stages: DlcProjection["stages"]): string {
	if (stages.length === 0) {
		return "未着手";
	}
	if (stages.every((stage) => stage.status === "skipped")) {
		return "対象外";
	}
	const matchesEvery = stages.every((stage) =>
		["completed", "skipped"].includes(stage.status),
	);
	if (matchesEvery) {
		return "完了";
	}
	const matchesSome = stages.some((stage) =>
		["active", "awaiting-approval", "revising"].includes(stage.status),
	);
	if (matchesSome) {
		return "進行中";
	}
	if (stages.some((stage) => stage.selection === "undetermined")) {
		return "条件の確認待ち";
	}
	return "未着手";
}

/** 表示対象の依頼に実行中・開始保留・実行先変更待ちがあるかを判定する。最新の画面状態を渡す。 */
export function executionBusy(view: DlcView, selected: DlcProjection): boolean {
	const intentPending =
		view.targetBusy ||
		view.assignmentPending ||
		view.intents.some(
			(intent) =>
				intent.intentId === selected.intentId &&
				intent.startHold !== undefined,
		);
	return (
		intentPending ||
		view.running.some((run) => run.intentId === selected.intentId)
	);
}

/** 工程の保存状態を変更せず、コード変更を伴う Phase の開始保留を重ねて表示する。 */
export function phaseExecutionStatus(
	stages: DlcProjection["stages"],
	phase: number,
	view: DlcView,
	selected: DlcProjection | null,
): string {
	const matchesPhase =
		phase < 3 ||
		!stages.some(
			(stage) => stage.status === "pending" && stage.selection !== "skip",
		);
	if (matchesPhase) {
		return phaseStatus(stages);
	}
	const matchesValue = view.intents.some(
		(intent) =>
			intent.intentId === selected?.intentId &&
			intent.startHold !== undefined,
	)
		? "実行保留"
		: phaseStatus(stages);
	return matchesValue;
}
