// 実行環境と設定は Intent 本文から切り離し、保存された依頼は Phase 0 で参照する。
import type { DlcAction, DlcProjection } from "@nerita/shared/dlc/contracts";
import type { useDlcWorkspace } from "./useDlcWorkspace";

export function DlcWorkspaceHeader({
	ui,
}: {
	ui: ReturnType<typeof useDlcWorkspace>;
}) {
	return (
		<header className="mb-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="m-0 text-[11px] text-muted">DLC Workspace</p>
					<h1 className="my-2 text-[20px] font-semibold break-words">
						{ui.newIntent
							? "新しい Intent"
							: (ui.selected?.title ?? "Intent を選択")}
					</h1>
				</div>
				<button
					type="button"
					onClick={() =>
						ui.send({
							type: "dlc/chat",
							requestId: crypto.randomUUID(),
						})
					}
				>
					チャットで確認
				</button>
			</div>
			<div className="flex flex-wrap items-center gap-3 text-muted">
				<span>
					実行環境: {ui.view.environment?.workspace ?? "確認中"} /{" "}
					{ui.view.environment?.branch ?? "ブランチ未取得"}
				</span>
				<label className="flex items-center gap-2">
					実行先
					<select
						aria-label="DLC のバックエンド"
						value={ui.view.backend}
						disabled={ui.view.active !== null}
						onChange={(event) => {
							const backend = event.target.value;
							if (backend === "pi" || backend === "codex") {
								ui.send({
									type: "dlc/backend",
									requestId: crypto.randomUUID(),
									backend,
								});
							}
						}}
					>
						<option value="codex">Codex</option>
						<option value="pi">Pi</option>
					</select>
				</label>
			</div>
		</header>
	);
}

export function IntentOverview({
	selected,
	action,
}: {
	selected: DlcProjection;
	action: (action: DlcAction) => void;
}) {
	return (
		<div className="mb-4">
			<h3 className="text-[13px]">作成時の依頼</h3>
			<p className="dlc-request">{selected.request}</p>
			<details className="mb-3">
				<summary>詳細設定</summary>
				<p>実行プロファイル: {selected.profile}</p>
			</details>
			<div className="dlc-toolbar">
				<button
					type="button"
					disabled={selected.workflowStatus !== "in-flight"}
					onClick={() => action({ type: "advance" })}
				>
					工程の実行条件を確認
				</button>
				<button
					type="button"
					disabled={
						selected.canCancel ||
						selected.workflowStatus === "archived"
					}
					onClick={() => action({ type: "archive" })}
				>
					アーカイブ
				</button>
			</div>
		</div>
	);
}
