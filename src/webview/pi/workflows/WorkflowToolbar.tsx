// 固定した操作欄と結果欄を、スクロールする編集内容から分離する。
import { useState } from "react";
import type { WorkflowBridge } from "../../../shared/workflows/messages";
import type { useWorkflow } from "./useWorkflow";

export type WorkflowEditorState = ReturnType<typeof useWorkflow>;

/** 保存状態と同期状態から、実行可能な操作だけを公開する。 */
export function WorkflowToolbar({
	editor,
	bridge,
	mode,
	valid,
	switchMode,
}: {
	editor: WorkflowEditorState;
	bridge: WorkflowBridge;
	mode: "graph" | "toml";
	valid: boolean;
	switchMode: () => void;
}) {
	const disabled = editor.busy || editor.locked;
	const dirty = !!editor.state?.dirty;
	return (
		<header className="shrink-0 border-b border-[var(--workflow-border)] p-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="min-w-0">
					<h1 className="text-base font-semibold">Pi Workflow</h1>
					<p className="mt-1 break-all text-xs opacity-65">
						{editor.state?.file ?? "読み込み中…"}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<button
						role="switch"
						aria-checked={mode === "toml"}
						aria-label="TOML 編集"
						disabled={mode === "toml" && !valid}
						onClick={switchMode}
					>
						{mode === "graph" ? "グラフ → TOML" : "TOML → グラフ"}
					</button>
					<WorkflowActions
						editor={editor}
						bridge={bridge}
						disabled={disabled}
						dirty={dirty}
						valid={valid}
					/>
				</div>
			</div>
			<p className="mt-3 text-xs opacity-65">
				グラフで編集すると TOML
				の書式は整えられ、コメントは削除されます。配置は表示専用です。
			</p>
		</header>
	);
}

/** 長い実行でも停止と承認画面への移動は有効にする。 */
function WorkflowActions({
	editor,
	bridge,
	disabled,
	dirty,
	valid,
}: {
	editor: WorkflowEditorState;
	bridge: WorkflowBridge;
	disabled: boolean;
	dirty: boolean;
	valid: boolean;
}) {
	return (
		<>
			<button
				aria-label="保存"
				className={dirty ? "workflow-unsaved" : ""}
				disabled={disabled}
				onClick={() => editor.request("save")}
			>
				保存{dirty ? " ●" : ""}
			</button>
			<button disabled={disabled} onClick={() => editor.request("check")}>
				検証
			</button>
			<button
				className="workflow-primary"
				disabled={disabled || dirty || !valid}
				onClick={() => editor.request("run")}
			>
				実行
			</button>
			<button
				disabled={!editor.state?.running}
				onClick={() => bridge.postMessage({ type: "stop" })}
			>
				停止
			</button>
			<button onClick={() => bridge.postMessage({ type: "chat" })}>
				AgentViewer
			</button>
		</>
	);
}

/** 検証した版に対応するスクリプトだけを表示する。 */
export function WorkflowFeedback({ editor }: { editor: WorkflowEditorState }) {
	const [showScript, setShowScript] = useState(false);
	const script = editor.reply?.script;
	const notice =
		editor.reply?.notice || "定義を保存してから実行してください。";
	return (
		<footer className="shrink-0 border-t border-[var(--workflow-border)] p-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p role="status" className="min-w-0 flex-1 break-words">
					{editor.state?.running
						? "実行中 · 承認はチャットで操作してください。エディタを閉じると停止します。"
						: notice}
				</p>
				<button
					disabled={!script}
					onClick={() => setShowScript((value) => !value)}
				>
					生成スクリプト{showScript ? "を閉じる" : "を表示"}
				</button>
			</div>
			{showScript && script && (
				<pre className="mt-3 max-h-48 overflow-auto rounded border border-[var(--workflow-border)] p-3 text-xs">
					{script}
				</pre>
			)}
		</footer>
	);
}

/** 競合時も入力は保持し、明示操作でだけ文書を読み直す。 */
export function WorkflowError({
	error,
	reload,
}: {
	error: string | null | undefined;
	reload: () => void;
}) {
	if (!error) {
		return null;
	}
	return (
		<div
			role="alert"
			className="shrink-0 overflow-auto border-b border-[var(--workflow-border)] p-3 text-[var(--vscode-errorForeground,#f88)]"
		>
			<p className="max-h-24 overflow-auto whitespace-pre-wrap break-words">
				{error}
			</p>
			<button onClick={reload}>文書を再読み込み（入力を破棄）</button>
		</div>
	);
}
