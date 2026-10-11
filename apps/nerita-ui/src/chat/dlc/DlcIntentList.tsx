// 一覧には利用者が次の操作を判断できる状態を示し、選択操作だけを Host へ要求する。
import { cn } from "cnfast";
import type { IntentSummary } from "@nerita/shared/dlc/contracts";
import type { useDlcWorkspace } from "./useDlcWorkspace";

const labels: Record<IntentSummary["status"], string> = {
	idle: "待機",
	running: "実行中",
	stopping: "停止中",
	review: "レビュー待ち",
	complete: "完了",
	archived: "アーカイブ済み",
	attention: "確認が必要",
};

const holdLabels: Record<
	NonNullable<IntentSummary["startHold"]>["reason"],
	string
> = {
	"worktree-required": "Worktree が必要",
	"trust-required": "信頼の確認が必要",
	unavailable: "開始条件の確認が必要",
};

export function DlcIntentList({
	ui,
}: {
	ui: ReturnType<typeof useDlcWorkspace>;
}) {
	return (
		<aside
			aria-label="Intent 一覧"
			className="flex min-h-0 flex-col gap-3 overflow-auto border-0 border-r border-solid border-panel-border bg-menu/30 p-3 @max-[600px]:max-h-[32vh] @max-[600px]:border-r-0 @max-[600px]:border-b"
		>
			<div className="flex items-center justify-between gap-2">
				<h1 className="m-0 text-[14px]">Intent</h1>
				<button
					type="button"
					disabled={ui.creation.pending}
					onClick={() => ui.creation.setCreating(true)}
				>
					新しい Intent
				</button>
			</div>
			<nav aria-label="Intent の選択" className="flex flex-col gap-2">
				{ui.view.intents.length === 0 && (
					<p className="text-muted">まだ Intent がありません。</p>
				)}
				{ui.view.intents.map((intent) => (
					<div key={intent.intentId} className="flex flex-col gap-2">
						<IntentButton intent={intent} ui={ui} />
						{intent.startHold &&
							intent.intentId === ui.selected?.intentId && (
								<StartHold intent={intent} ui={ui} />
							)}
					</div>
				))}
			</nav>
			<button
				type="button"
				onClick={() =>
					ui.send({
						type: "dlc/read",
						requestId: crypto.randomUUID(),
					})
				}
			>
				再読込み
			</button>
		</aside>
	);
}

function IntentButton({
	intent,
	ui,
}: {
	intent: IntentSummary;
	ui: ReturnType<typeof useDlcWorkspace>;
}) {
	const selected = intent.intentId === ui.selected?.intentId;
	const target = ui.view.targets.find(
		(item) => item.id === intent.execution?.targetId,
	);
	return (
		<button
			type="button"
			data-intent-id={intent.intentId}
			aria-label={intent.title}
			aria-pressed={selected}
			className={cn(
				"flex flex-col gap-2 px-3 py-3 text-left",
				selected && "border-focus bg-message-user",
			)}
			onClick={() => ui.select(intent.intentId)}
		>
			<strong className="w-full break-words">{intent.title}</strong>
			<span className="text-[11px] text-muted">
				{intent.startHold
					? holdLabels[intent.startHold.reason]
					: labels[intent.status]}
			</span>
			<span className="text-[11px] text-muted">
				{intent.execution
					? `${target?.name ?? "消失した Worktree"} · ${intent.execution.backend === "pi" ? "Pi" : "Codex"}`
					: "実行先未選択"}
			</span>
		</button>
	);
}

/** 保留の解消は利用者が明示的に操作する。確認・作成だけで実行を開始しない。 */
function StartHold({
	intent,
	ui,
}: {
	intent: IntentSummary;
	ui: ReturnType<typeof useDlcWorkspace>;
}) {
	return (
		<div
			aria-label="実行開始の保留"
			className="flex flex-col gap-2 rounded-md border border-solid border-panel-border p-2 text-[11px]"
		>
			<p role="status" className="m-0 break-words text-muted">
				{intent.startHold?.message}
			</p>
			<a href="#dlc-worktree">実行先を選択</a>
			{intent.startHold?.reason === "worktree-required" && (
				<button
					type="button"
					onClick={() =>
						ui.send({
							type: "dlc/worktreeCreate",
							requestId: crypto.randomUUID(),
						})
					}
				>
					新しい Worktree を作成
				</button>
			)}
			{intent.startHold?.reason === "trust-required" && (
				<button
					type="button"
					onClick={() =>
						ui.send({
							type: "dlc/trust",
							requestId: crypto.randomUUID(),
						})
					}
				>
					信頼設定を開く
				</button>
			)}
			<button
				type="button"
				onClick={() =>
					ui.send({
						type: "dlc/read",
						requestId: crypto.randomUUID(),
					})
				}
			>
				開始条件を再確認
			</button>
		</div>
	);
}
