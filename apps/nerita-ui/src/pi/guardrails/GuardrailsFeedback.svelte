<!-- ガードレールの操作結果・警告・判定シミュレーションの結果を表示する。 -->
<script lang="ts">
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import { cn } from "cnfast";
	import { type GuardReply } from "@nerita/shared/guardrails/messages";

	let { reply }: { reply: Extract<GuardReply, { type: "reply" }> | null } =
		$props();
	let result = $derived(reply?.result);

	import GuardrailsDecision from "./GuardrailsDecision.svelte";
</script>

{#if reply}
	<section
		aria-live="polite"
		class={cn(
			"flex flex-col gap-2 rounded border border-panel-border bg-input p-3",
			"text-input-text",
		)}
	>
		{#if isNonEmptyString(reply.error)}
			<p
				role="alert"
				class="m-0 break-words whitespace-pre-wrap text-tool-error"
			>
				{reply.error}
			</p>
		{:else}
			<p class="m-0 text-[13px]">{reply.notice}</p>
		{/if}
		{#each reply.warnings as warning (warning)}
			<p class="m-0 text-warning">{warning}</p>
		{/each}
		{#if result}
			<GuardrailsDecision {...{ result }} />
		{/if}
	</section>
{/if}
