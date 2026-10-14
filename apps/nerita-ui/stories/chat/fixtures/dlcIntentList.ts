// Intent 一覧の保留理由と実行先を、Host から届く表示データとして用意する。
import type {
	DlcStartHold,
	DlcView,
	IntentSummary,
} from "@nerita/shared/dlc/contracts";

const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const holds: Record<DlcStartHold["reason"], DlcStartHold> = {
	"worktree-required": {
		reason: "worktree-required",
		message:
			"ワークスペースでエージェントが実行中です。並行して実行するには、ワークツリーを作成してください",
	},
	"trust-required": {
		reason: "trust-required",
		message: "ワークスペースを信頼してください",
	},
	unavailable: {
		reason: "unavailable",
		message:
			"実行先を確認できません。再読込みして Worktree を選択してください。",
	},
};

/** 選択済みの一覧を初期化し、保留パネルを開いた状態にする。 */
function listView(
	intents: IntentSummary[],
	targets: DlcView["targets"] = [],
): DlcView {
	const selected = intents[0]!;
	return {
		mode: "dlc",
		backend: "codex",
		error: null,
		active: null,
		targets,
		targetId: selected.execution?.targetId ?? null,
		targetBusy: false,
		assignmentPending: false,
		running: [],
		execution: null,
		environment: { workspace: "sample", branch: "feature/dlc-ui" },
		intents,
		selected: {
			intentId: selected.intentId,
			title: selected.title,
			request: "一覧の表示を確認するための依頼",
			profile: "classic",
			workflowStatus: "in-flight",
			revision: 0,
			stage: "planning",
			workItems: [],
			canRun: false,
			canCancel: false,
			routingReason: "unsupported-stage",
			stages: [],
		},
	};
}

/** 同じ保留理由の未選択 Intent も並べ、選択中だけに保留理由が出ることを確認する。 */
export function intentHoldView(reason: DlcStartHold["reason"]): DlcView {
	return listView([
		{
			intentId: first,
			title: "開始を保留している Intent",
			status: "idle",
			startHold: holds[reason],
		},
		{
			intentId: second,
			title: "未選択の Intent",
			status: "idle",
			startHold: holds[reason],
		},
	]);
}

/** バックエンドと実行先の有無を、一覧内で比較できるように並べる。 */
export const intentExecutionView = listView(
	[
		{
			intentId: first,
			title: "Codex で実行中",
			status: "running",
			execution: { targetId: "codex-worktree", backend: "codex" },
		},
		{
			intentId: second,
			title: "Pi で実行中",
			status: "running",
			execution: { targetId: "pi-worktree", backend: "pi" },
		},
		{
			intentId: "00000000-0000-4000-8000-000000000003",
			title: "Codex の実行先が消失",
			status: "attention",
			execution: { targetId: "missing-codex", backend: "codex" },
		},
		{
			intentId: "00000000-0000-4000-8000-000000000004",
			title: "Pi の実行先が消失",
			status: "attention",
			execution: { targetId: "missing-pi", backend: "pi" },
		},
		{
			intentId: "00000000-0000-4000-8000-000000000005",
			title: "実行先を選んでいない Intent",
			status: "idle",
		},
	],
	[
		{
			id: "codex-worktree",
			name: "feature/codex-ui",
			directory: "worktrees/codex-ui",
			branch: "feature/codex-ui",
			main: false,
			removable: true,
			trusted: true,
		},
		{
			id: "pi-worktree",
			name: "feature/pi-ui",
			directory: "worktrees/pi-ui",
			branch: "feature/pi-ui",
			main: false,
			removable: true,
			trusted: true,
		},
	],
);
