// DLC の操作検証に用いる初期表示だけを定義する。
import type { DlcProjection, DlcView } from "@nerita/shared/dlc/contracts";
import type { BackendId } from "@nerita/shared/backend";
export const first = "00000000-0000-4000-8000-000000000001";
export const second = "00000000-0000-4000-8000-000000000002";
export const third = "00000000-0000-4000-8000-000000000003";
export function projection(intentId: string, title: string): DlcProjection {
	return {
		intentId,
		title,
		request: `${title} の依頼原文`,
		profile: "classic",
		workflowStatus: "in-flight",
		revision: 0,
		stage: "planning",
		workItems: [],
		canRun: false,
		canCancel: false,
		routingReason: "unsupported-stage",
		stages: [
			{
				id: "0.1",
				name: "Workspace",
				selection: "execute",
				status: "completed",
				reason: "初期化済み",
			},
			{
				id: "2.1",
				name: "Requirements",
				selection: "execute",
				status: "pending",
				reason: "実行待ち",
			},
			{
				id: "3.1",
				name: "Construction",
				selection: "execute",
				status: "pending",
				reason: "実行待ち",
			},
		],
	};
}
export function view(selected = projection(first, "最初の Intent")): DlcView {
	return {
		mode: "dlc",
		backend: "codex",
		error: null,
		active: null,
		targets: [],
		targetId: null,
		targetBusy: false,
		assignmentPending: false,
		running: [],
		execution: null,
		selected,
		environment: { workspace: "sample", branch: "feature/dlc-ui" },
		intents: [
			{ intentId: first, title: "最初の Intent", status: "idle" },
			{ intentId: second, title: "別の Intent", status: "idle" },
		],
	};
}

/** Host の未信頼記録が同じでも、Codex と Pi では実行先の信頼表示が異なる。 */
export function untrustedWorktreeView(backend: BackendId): DlcView {
	return {
		...view(),
		backend,
		targetId: "worktree",
		targets: [
			{
				id: "worktree",
				name: "work-new",
				directory: "work-new",
				branch: "feature/work",
				main: false,
				removable: true,
				trusted: false,
			},
		],
	};
}
