<!-- 閲覧中の Run と入力の参照先を示し、停止要求をその Run だけに限定する。 -->
<script lang="ts">
	import type { DlcView } from "@nerita/shared/dlc/contracts";
	import type { ChatState } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";

	let {
		view,
		state,
		send,
	}: { view: DlcView; state: ChatState; send: (message: UiMessage) => void } =
		$props();
	let other = $derived(
		view.active !== null &&
			view.active.intentId !== view.selected?.intentId,
	);
	let active = $derived(
		view.running.some(
			(run) =>
				run.intentId === view.selected?.intentId &&
				run.attemptId === view.execution?.attemptId,
		),
	);
	const validIds = $derived(
		isNonEmptyString(state.sessionId) && isNonEmptyString(state.runId),
	);
	const running = $derived(
		state.run === "running" || state.run === "cancelling",
	);
	const canStop = $derived(active && validIds && running);
	/** 表示中の会話と Run を指定して停止を要求し、別の実行先へ停止を送らない。 */
	function stop() {
		const sessionId = state.sessionId;
		const runId = state.runId;
		if (canStop && isNonEmptyString(sessionId) && isNonEmptyString(runId)) {
			send({
				type: "prompt/cancel",
				requestId: crypto.randomUUID(),
				sessionId,
				runId,
			});
		}
	}
</script>

<section
	aria-label="DLC の実行情報"
	class="border-0 border-b border-solid border-panel-border px-3 py-2 text-[11px]"
>
	<div class="flex flex-wrap items-center justify-between gap-2">
		<span class="text-muted"
			>{view.selected?.title ?? "Intent を選択してください"}</span
		><span class="text-muted">{view.backend === "pi" ? "Pi" : "Codex"}</span
		>{#if canStop}<button
				type="button"
				aria-label="DLC の会話を停止"
				disabled={state.run === "cancelling"}
				onclick={stop}>停止</button
			>{/if}
	</div>
	<p class="my-1 break-all text-muted">
		実行先: {state.cwd ??
			view.targets.find((target) => target.id === view.targetId)
				?.directory ??
			"未選択"}
	</p>
	{#if other}<p role="status">
			別の Intent を実行しています。 <button
				type="button"
				onclick={() => {
					if (view.active !== null) {
						send({
							type: "dlc/select",
							requestId: crypto.randomUUID(),
							intentId: view.active.intentId,
						});
					}
				}}>実行中の Intent を表示</button
			>
		</p>{/if}
	{#if view.execution !== null}
		<details class="mt-2">
			<summary>送信した実行内容（全文）</summary>
			<dl class="break-all text-muted">
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
				class="max-h-[35vh] overflow-auto break-words whitespace-pre-wrap">{view
					.execution.prompt}</pre>
		</details>
	{/if}
	{#if view.selected?.workItems.some((item) => item.attempts.length > 0)}
		<label class="mt-2 flex items-center gap-2"
			>実行履歴
			<select
				aria-label="DLC の実行履歴"
				class="min-w-0 flex-1 rounded border border-solid border-input-border bg-input px-2 py-1 text-[11px] text-input-text focus-visible:outline-1 focus-visible:outline-focus"
				value={view.execution?.attemptId ?? ""}
				onchange={(event) => {
					if (view.selected && event.currentTarget.value !== "") {
						send({
							type: "dlc/attempt",
							requestId: crypto.randomUUID(),
							intentId: view.selected.intentId,
							attemptId: event.currentTarget.value,
						});
					}
				}}
			>
				<option value="" disabled>実行を選択</option
				>{#each view.selected.workItems as item (item.id)}{#each item.attempts as attempt, index (attempt.id)}<option
							value={attempt.id}
							>{item.title} · 実行 {index + 1} · {attempt.status}</option
						>{/each}{/each}
			</select>
		</label>
	{/if}
</section>
