// DLC の入力・履歴の参照先を示し、実行イベント自体は既存の会話表示に任せる。
import type { DlcView } from "@nerita/shared/dlc/contracts";
import type { ChatState } from "@nerita/shared/chatState";
import type { UiMessage } from "@nerita/shared/messages";

type RunInfoProps = {
	view: DlcView;
	state: ChatState;
	send: (message: UiMessage) => void;
};
export function DlcRunInfo({ view, state, send }: RunInfoProps) {
	const other =
		view.active !== null &&
		view.active.intentId !== view.selected?.intentId;
	return (
		<section
			aria-label="DLC の実行情報"
			className="border-0 border-b border-solid border-panel-border px-3 py-2 text-[11px]"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="text-muted">
					{view.selected?.title ?? "Intent を選択してください"}
				</span>
				<button
					type="button"
					onClick={() =>
						send({
							type: "dlc/open",
							requestId: crypto.randomUUID(),
						})
					}
				>
					DLC の作業画面を開く
				</button>
			</div>
			{view.error !== null && (
				<p role="alert" className="text-tool-error">
					{view.error}
				</p>
			)}
			{other && (
				<p role="status">
					別の Intent を実行しています。{" "}
					<button
						type="button"
						onClick={() => {
							if (view.active !== null) {
								send({
									type: "dlc/select",
									requestId: crypto.randomUUID(),
									intentId: view.active.intentId,
								});
							}
						}}
					>
						実行中の Intent を表示
					</button>
				</p>
			)}
			<ExecutionDetails view={view} state={state} />
			<HistorySelector view={view} send={send} />
		</section>
	);
}

function ExecutionDetails({
	view,
	state,
}: Pick<RunInfoProps, "view" | "state">) {
	if (view.execution === null) {
		return null;
	}
	return (
		<details className="mt-2">
			<summary>送信した実行内容（全文）</summary>
			<dl className="break-all text-muted">
				<dt>Intent</dt>
				<dd>{view.selected?.intentId}</dd>
				<dt>実行記録</dt>
				<dd>{view.execution.attemptId}</dd>
				<dt>セッション</dt>
				<dd>{state.sessionId ?? "接続待ち"}</dd>
				<dt>Run / ターン</dt>
				<dd>{state.runId ?? "記録なし"}</dd>
			</dl>
			<pre
				aria-label="送信した実行内容"
				className="max-h-[35vh] overflow-auto break-words whitespace-pre-wrap"
			>
				{view.execution.prompt}
			</pre>
		</details>
	);
}
function HistorySelector({ view, send }: Pick<RunInfoProps, "view" | "send">) {
	const selected = view.selected;
	if (
		selected === null ||
		!selected.workItems.some((item) => item.attempts.length > 0)
	) {
		return null;
	}
	return (
		<label className="mt-2 flex items-center gap-2">
			実行履歴
			<select
				aria-label="DLC の実行履歴"
				className="min-w-0 flex-1 rounded border border-solid border-input-border bg-input px-2 py-1 text-[11px] text-input-text focus-visible:outline-1 focus-visible:outline-focus"
				value={view.execution?.attemptId ?? ""}
				onChange={(event) => {
					if (event.target.value !== "") {
						send({
							type: "dlc/attempt",
							requestId: crypto.randomUUID(),
							intentId: selected.intentId,
							attemptId: event.target.value,
						});
					}
				}}
			>
				<option value="" disabled>
					実行を選択
				</option>
				{selected.workItems.flatMap((item) =>
					item.attempts.map((attempt, index) => (
						<option key={attempt.id} value={attempt.id}>
							{item.title} · 実行 {index + 1} · {attempt.status}
						</option>
					)),
				)}
			</select>
		</label>
	);
}
