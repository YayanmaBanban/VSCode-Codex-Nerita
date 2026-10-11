// Worktree の実行先と管理操作を表示し、パスを直接指定する入力は提供しない。
import type { useDlcWorkspace } from "./useDlcWorkspace";
import { backendWorkspaceTrusted } from "@nerita/shared/backend";
/** 実行先を Intent ごとに選び、実行中の表示切替では変更しない。 */
export function WorktreeControls({
	ui,
}: {
	ui: ReturnType<typeof useDlcWorkspace>;
}) {
	const selected = ui.selected;
	const target = ui.view.targets.find((item) => item.id === ui.view.targetId);
	const active = ui.view.running.some(
		(run) => run.intentId === selected?.intentId,
	);
	return (
		<div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
			<label className="flex min-w-0 items-center gap-2">
				Worktree
				<select
					id="dlc-worktree"
					aria-label="DLC の Worktree"
					className="max-w-full min-w-0"
					value={ui.view.targetId ?? ""}
					disabled={!selected || active || ui.view.assignmentPending}
					onChange={(event) => {
						if (selected) {
							ui.send({
								type: "dlc/target",
								requestId: crypto.randomUUID(),
								intentId: selected.intentId,
								revision: selected.revision,
								targetId: event.target.value,
							});
						}
					}}
				>
					{ui.view.targets.map((item) => (
						<option key={item.id} value={item.id}>
							{item.main ? "main" : item.name}
							{backendWorkspaceTrusted(
								ui.view.backend,
								() => item.trusted,
							)
								? ""
								: "（未信頼）"}
						</option>
					))}
				</select>
			</label>
			<WorktreeActions ui={ui} active={active} />
			{target && (
				<p className="m-0 w-full text-[11px] break-all text-muted">
					実行ディレクトリ: {target.directory}
				</p>
			)}
			{ui.view.targetBusy && !active && (
				<p role="status" className="m-0 w-full text-muted">
					この Worktree では別の実行が進行中です。
				</p>
			)}
			{ui.view.assignmentPending && (
				<p role="status" className="m-0 w-full text-muted">
					実行先を保存しています。
				</p>
			)}
		</div>
	);
}

function WorktreeActions({
	ui,
	active,
}: {
	ui: ReturnType<typeof useDlcWorkspace>;
	active: boolean;
}) {
	const target = ui.view.targets.find((item) => item.id === ui.view.targetId);
	return (
		<>
			<button
				type="button"
				disabled={ui.view.assignmentPending}
				title="main の HEAD から作成します。未コミットの変更は含みません。"
				onClick={() =>
					ui.send({
						type: "dlc/worktreeCreate",
						requestId: crypto.randomUUID(),
					})
				}
			>
				Worktree を作成
			</button>
			{target &&
				!backendWorkspaceTrusted(
					ui.view.backend,
					() => target.trusted,
				) && (
					<button
						type="button"
						onClick={() =>
							ui.send({
								type: "dlc/trust",
								requestId: crypto.randomUUID(),
							})
						}
					>
						実行先の信頼を確認
					</button>
				)}
			{target?.removable === true && (
				<button
					type="button"
					disabled={ui.view.targetBusy || active}
					onClick={() =>
						ui.send({
							type: "dlc/worktreeRemove",
							requestId: crypto.randomUUID(),
							targetId: target.id,
						})
					}
				>
					Worktree を削除
				</button>
			)}
		</>
	);
}
