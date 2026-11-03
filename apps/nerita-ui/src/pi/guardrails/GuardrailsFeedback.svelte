<!-- 判定シミュレーションの結果を表示し、操作通知はフッターへ任せる。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import { type GuardReply } from "@nerita/shared/guardrails/messages";

	let { reply }: { reply: Extract<GuardReply, { type: "reply" }> | null } =
		$props();
	let result = $derived(reply?.result);

	import GuardrailsDecision from "./GuardrailsDecision.svelte";
</script>

{#if result}
	<section
		aria-label="判定結果"
		aria-live="polite"
		class={cn(
			"flex flex-col gap-2 rounded border border-panel-border bg-input p-3",
			"text-input-text",
		)}
	>
		<GuardrailsDecision {result} warnings={reply?.warnings ?? []} />
	</section>
{/if}
