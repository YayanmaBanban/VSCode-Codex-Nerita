<!-- Plan 完了後の実装先を選び、対象 Run の決定だけを Host へ送る。 -->
<script lang="ts">
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import type { ChatState } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import { prefersReducedMotion } from "svelte/motion";
	import BorderBeam from "../ui/BorderBeam.svelte";
	import ButtonCurtain from "../ui/ButtonCurtain.svelte";
	let {
		state,
		send,
	}: { state: ChatState; send: (message: UiMessage) => void } = $props();
	const runPending = $derived(
		state.run === "running" ||
			state.run === "cancelling" ||
			state.sessionPending,
	);
	const disabled = $derived(runPending || state.configPending);
	/** 最新状態のセッションと完了した Plan を対応付けて送信する。 */
	function choose(action: "current" | "new" | "continue") {
		if (!state.planDecision) {
			return;
		}
		if (!isNonEmptyString(state.sessionId)) {
			return;
		}
		if (disabled) {
			return;
		}
		send({
			type: "plan/decide",
			requestId: crypto.randomUUID(),
			sessionId: state.sessionId,
			runId: state.planDecision.runId,
			action,
		});
	}
</script>

{#if state.planDecision && isNonEmptyString(state.sessionId) && state.connection === "ready"}
	<section
		aria-label="Planの実装"
		class="relative my-4 overflow-hidden rounded-lg border border-solid border-[var(--nerita-testing-icon-passed)] p-4"
	>
		{#if !prefersReducedMotion.current}<BorderBeam
				size={80}
				duration={6}
				colorFrom="#45d483"
				colorTo="#a2f2ae"
				beamBorderRadius={8}
			/>{/if}
		<h2 class="mb-3 text-[13px] font-semibold">
			このプランを実装しますか？
		</h2>
		<div class="flex flex-wrap gap-2">
			<button
				type="button"
				{disabled}
				onclick={() => choose("current")}
				class="primary border-transparent bg-primary text-primary-text"
				>このセッションで実装する</button
			>
			<button
				type="button"
				{disabled}
				onclick={() => choose("new")}
				class="quiet group relative isolate overflow-hidden bg-transparent"
				>新規セッションで実装する<ButtonCurtain
					name="新規セッションで実装する"
					className="bg-green-300"
				/></button
			>
			<button
				type="button"
				{disabled}
				onclick={() => choose("continue")}
				class="quiet group relative isolate overflow-hidden bg-transparent"
				>プランを続ける<ButtonCurtain
					name="プランを続ける"
					className="bg-green-300"
				/></button
			>
		</div>
	</section>
{/if}
