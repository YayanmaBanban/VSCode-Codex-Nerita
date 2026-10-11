// DLC の入力・履歴の参照先を示し、実行イベント自体は既存の会話表示に任せる。
import type { DlcView } from "@nerita/shared/dlc/contracts";
import type { ChatState } from "@nerita/shared/chatState";
import type { UiMessage } from "@nerita/shared/messages";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";

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
				<span className="text-muted">
					{view.backend === "pi" ? "Pi" : "Codex"}
				</span>
				<RunControl view={view} state={state} send={send} />
			</div>
			<ExecutionTarget view={view} state={state} />
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

/** 閲覧中の履歴では停止ボタンを出さず、現在表示している Run だけを対象にする。 */
function RunControl({ view, state, send }: RunInfoProps) {
	const active = view.running.some(
		(run) =>
			run.intentId === view.selected?.intentId &&
			run.attemptId === view.execution?.attemptId,
	);
	const sessionId = state.sessionId;
	const runId = state.runId;
	if (!active || !isNonEmptyString(sessionId) || !isNonEmptyString(runId)) {
		return null;
	}
	if (state.run !== "running" && state.run !== "cancelling") {
		return null;
	}
	return (
		<button
			type="button"
			aria-label="DLC の会話を停止"
			disabled={state.run === "cancelling"}
			onClick={() =>
				send({
					type: "prompt/cancel",
					requestId: crypto.randomUUID(),
					sessionId,
					runId,
				})
			}
		>
			停止
		</button>
	);
}

/** 過去の会話では現在の割当より、その実行が実際に使ったディレクトリを優先する。 */
function ExecutionTarget({
	view,
	state,
}: Pick<RunInfoProps, "view" | "state">) {
	return (
		<p className="my-1 break-all text-muted">
			実行先:{" "}
			{state.cwd ??
				view.targets.find((target) => target.id === view.targetId)
					?.directory ??
				"未選択"}
		</p>
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
