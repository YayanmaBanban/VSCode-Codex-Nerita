// 手動タスクと工程の状態を独立して確認するための Host 表示データ。
import type { DlcProjection, DlcView } from "@nerita/shared/dlc/contracts";
import { first, projection, view } from "./workspaceState";

type ExecutionStatus =
	| "ready"
	| "running"
	| "stopping"
	| "failed"
	| "cancelled"
	| "interrupted"
	| "implemented";

/** タスクと実行履歴の状態を揃え、未実行のタスクには履歴を付けない。 */
function workItem(status: ExecutionStatus): DlcProjection["workItems"][number] {
	const attemptStatus = status === "implemented" ? "completed" : status;
	return {
		id: "notification-task",
		title: "通知一覧を追加",
		status,
		attemptCount: status === "ready" ? 0 : 1,
		attempts:
			attemptStatus === "ready"
				? []
				: [
						{
							id: "notification-attempt",
							status: attemptStatus,
							detail: "通知一覧の実装記録",
						},
					],
		detail:
			status === "failed"
				? "接続が切れたため、変更内容を確認してください。"
				: null,
	};
}

/** 異なる集計状態を全 Phase に配置し、タスク計画を入力できる状態にする。 */
export function phasePlanning(): DlcView {
	const selected: DlcProjection = {
		...projection(first, "通知機能の実装"),
		stages: [
			{
				id: "0.1",
				name: "Workspace",
				selection: "execute",
				status: "completed",
				reason: "作業領域を確認済み",
			},
			{
				id: "1.1",
				name: "Ideation",
				selection: "skip",
				status: "skipped",
				reason: "既存の要件を利用するため対象外",
			},
			{
				id: "2.1",
				name: "Requirements",
				selection: "undetermined",
				status: "pending",
				reason: "通知する対象の確認が必要",
			},
			{
				id: "3.1",
				name: "Implementation",
				selection: "execute",
				status: "pending",
				reason: "手動タスクの計画待ち",
			},
			{
				id: "4.1",
				name: "Operation",
				selection: "execute",
				status: "pending",
				reason: "運用手順の確認待ち",
			},
		],
	};
	return {
		...view(selected),
		intents: [{ intentId: first, title: selected.title, status: "idle" }],
	};
}

/** 実行待ち・実行中・停止中・再試行・レビュー待ちを固定応答として用意する。 */
export function phaseExecution(status: ExecutionStatus): DlcView {
	const initial = phasePlanning();
	const running = status === "running" || status === "stopping";
	const summaryStatuses = {
		ready: "idle",
		running: "running",
		stopping: "stopping",
		failed: "attention",
		cancelled: "attention",
		interrupted: "attention",
		implemented: "review",
	} as const;
	const selected: DlcProjection = {
		...initial.selected!,
		stage: status === "implemented" ? "awaiting-review" : "implementing",
		canRun: status === "ready",
		canCancel: running,
		revision: 2,
		workItems: [workItem(status)],
	};
	return {
		...initial,
		selected,
		active: running
			? { intentId: first, attemptId: "notification-attempt" }
			: null,
		running: running
			? [
					{
						intentId: first,
						attemptId: "notification-attempt",
						targetId: "main",
					},
				]
			: [],
		execution:
			status === "ready"
				? null
				: {
						attemptId: "notification-attempt",
						prompt: "通知一覧を追加してください。対象: src/notifications.ts",
					},
		intents: [
			{
				intentId: first,
				title: selected.title,
				status: summaryStatuses[status],
			},
		],
	};
}
