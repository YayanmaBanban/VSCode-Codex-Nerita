// エディタの Intent 一覧と Phase 作業領域を組み立て、実行は共通 Host に要求する。
import type { Bridge } from "@nerita/shared/bridge";
import { IntentForm } from "./DlcForms";
import { DlcPhases } from "./DlcPhases";
import { DlcIntentList } from "./DlcIntentList";
import { DlcWorkspaceHeader, IntentOverview } from "./DlcWorkspaceHeader";
import { useDlcWorkspace } from "./useDlcWorkspace";
import "./dlc.css";
import "../chat.css";

export function DlcWorkspace({ bridge }: { bridge: Bridge }) {
	const ui = useDlcWorkspace(bridge);
	return (
		<main
			aria-label="DLC Workspace"
			className="dlc-workspace dlc-panel @container h-dvh text-[12px]"
		>
			<div className="grid h-full grid-cols-[200px_minmax(0,1fr)] @max-[600px]:grid-cols-1 @max-[600px]:grid-rows-[auto_minmax(0,1fr)]">
				<DlcIntentList ui={ui} />
				<div className="min-h-0 min-w-0 overflow-auto p-5 @max-[600px]:p-3">
					<DlcWorkspaceHeader ui={ui} />
					<DlcWorkspaceContent ui={ui} />
				</div>
			</div>
		</main>
	);
}

function DlcWorkspaceContent({
	ui,
}: {
	ui: ReturnType<typeof useDlcWorkspace>;
}) {
	const error = ui.view.error ?? ui.editor.error;
	return (
		<>
			{error !== null && (
				<div
					role="alert"
					className="dlc-error mb-3 rounded-md border border-solid border-panel-border"
				>
					{error}
					<div className="dlc-toolbar mt-2">
						<button
							type="button"
							onClick={() =>
								ui.send({
									type: "dlc/read",
									requestId: crypto.randomUUID(),
								})
							}
						>
							状態を再確認
						</button>
						<button
							type="button"
							onClick={() =>
								ui.send({
									type: "dlc/recover",
									requestId: crypto.randomUUID(),
								})
							}
						>
							保存記録から復旧
						</button>
					</div>
				</div>
			)}
			{ui.view.active &&
				ui.view.active.intentId !== ui.selected?.intentId && (
					<p role="status" className="mb-3 text-muted">
						別の Intent
						を実行しています。実行が終わってから次のタスクを開始できます。
					</p>
				)}
			{ui.newIntent || ui.selected ? (
				<DlcPhases
					key={ui.selected?.intentId ?? "new"}
					selected={ui.selected}
					view={ui.view}
					expanded={ui.expanded}
					onToggle={ui.toggle}
					action={ui.action}
					send={ui.send}
					initialization={<Initialization ui={ui} />}
				/>
			) : (
				<p className="text-muted">
					左の一覧から Intent を選択してください。
				</p>
			)}
		</>
	);
}

function Initialization({ ui }: { ui: ReturnType<typeof useDlcWorkspace> }) {
	if (ui.newIntent) {
		return (
			<IntentForm
				send={ui.send}
				pending={ui.creation.pending}
				onSubmitted={ui.creation.submit}
			/>
		);
	}
	return (
		ui.selected && (
			<IntentOverview selected={ui.selected} action={ui.action} />
		)
	);
}
