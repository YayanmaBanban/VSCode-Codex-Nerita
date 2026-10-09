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
					<button
						key={intent.intentId}
						type="button"
						data-intent-id={intent.intentId}
						aria-label={intent.title}
						aria-pressed={intent.intentId === ui.selected?.intentId}
						className={cn(
							"flex flex-col gap-2 px-3 py-3 text-left",
							intent.intentId === ui.selected?.intentId &&
								"border-focus bg-message-user",
						)}
						onClick={() => ui.select(intent.intentId)}
					>
						<strong className="w-full break-words">
							{intent.title}
						</strong>
						<span className="text-[11px] text-muted">
							{labels[intent.status]}
						</span>
						<span className="text-[11px] text-muted">
							現在のワークスペース ·{" "}
							{ui.view.environment?.branch ?? "ブランチ未取得"}
						</span>
					</button>
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
