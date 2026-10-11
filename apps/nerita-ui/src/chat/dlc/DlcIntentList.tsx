// 一覧には利用者が次の操作を判断できる状態を示し、選択操作だけを Host へ要求する。
import { cn } from "cnfast";
import { Plus, RotateCw } from "lucide-react";
import { useId } from "react";
import type { IntentSummary } from "@nerita/shared/dlc/contracts";
import {
	StatusIndicator,
	type StatusIndicatorState,
} from "../../ui/StatusIndicator";
import { SettingsTooltip } from "../SettingsTooltip";
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

const indicatorStates: Record<IntentSummary["status"], StatusIndicatorState> = {
	idle: "idle",
	running: "running",
	stopping: "warning",
	review: "warning",
	complete: "completed",
	archived: "completed",
	attention: "warning",
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
			<IntentListActions ui={ui} />
			<nav aria-label="Intent の選択" className="flex flex-col gap-2">
				{ui.view.intents.length === 0 && (
					<p className="text-muted">Intent がありません。</p>
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
		</aside>
	);
}

/** 作成と再読み込みを隣接するアイコン操作としてまとめる。 */
function IntentListActions({ ui }: { ui: ReturnType<typeof useDlcWorkspace> }) {
	return (
		<div className="flex items-center gap-1">
			<SettingsTooltip content="Intentの作成">
				<button
					type="button"
					aria-label="Intentの作成"
					className="inline-flex size-7 items-center justify-center rounded-md border-0 bg-transparent p-0 text-inherit hover:bg-settings-hover"
					disabled={ui.creation.pending}
					onClick={() => ui.creation.setCreating(true)}
				>
					<Plus size={16} aria-hidden="true" />
				</button>
			</SettingsTooltip>
			<SettingsTooltip content="再読み込み">
				<button
					type="button"
					aria-label="再読み込み"
					className="inline-flex size-7 items-center justify-center rounded-md border-0 bg-transparent p-0 text-inherit hover:bg-settings-hover"
					onClick={() =>
						ui.send({
							type: "dlc/read",
							requestId: crypto.randomUUID(),
						})
					}
				>
					<RotateCw size={16} aria-hidden="true" />
				</button>
			</SettingsTooltip>
		</div>
	);
}

/** 状態名は説明として残し、タイトルの隣には共通のインジケーターを表示する。 */
function IntentButton({
	intent,
	ui,
}: {
	intent: IntentSummary;
	ui: ReturnType<typeof useDlcWorkspace>;
}) {
	const statusId = useId();
	const selected = intent.intentId === ui.selected?.intentId;
	const target = ui.view.targets.find(
		(item) => item.id === intent.execution?.targetId,
	);
	const statusLabel = intent.startHold
		? holdLabels[intent.startHold.reason]
		: labels[intent.status];
	return (
		<SettingsTooltip content={statusLabel}>
			<button
				type="button"
				data-intent-id={intent.intentId}
				aria-label={intent.title}
				aria-describedby={statusId}
				aria-pressed={selected}
				className={cn(
					"flex flex-col gap-2 px-3 py-3 text-left",
					selected && "border-focus bg-message-user",
				)}
				onClick={() => ui.select(intent.intentId)}
			>
				<span id={statusId} className="sr-only">
					{statusLabel}
				</span>
				<span className="flex w-full items-center gap-2">
					<StatusIndicator
						status={
							intent.startHold
								? "warning"
								: indicatorStates[intent.status]
						}
					/>
					<strong className="min-w-0 break-words">
						{intent.title}
					</strong>
				</span>
				<span className="text-[11px] text-muted">
					{intent.execution
						? `${target?.name ?? "ワークツリーが不明です"}`
						: "ワークスペース"}
				</span>
			</button>
		</SettingsTooltip>
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
