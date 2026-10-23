<!-- 出力プレビューと詳細取得の開閉を表示し、閉じると範囲本文を解放する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import type { ToolOutputPreview } from "@nerita/shared/toolOutput";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import ChevronUp from "@lucide/svelte/icons/chevron-up";
	import { useToolOutputBridge } from "./ToolExpansion.svelte";
	import CommandOutput from "./CommandOutput.svelte";
	import OutputRange from "./OutputRange.svelte";

	let { output }: { output: ToolOutputPreview } = $props();
	const getBridge = useToolOutputBridge();
	const rangeId = $props.id();
	let expanded = $state(false);
	const bridge = $derived(getBridge?.());
	const canExpand = $derived(
		output.truncated &&
			isNonEmptyString(output.outputRef) &&
			bridge !== undefined,
	);
</script>

<section>
	<CommandOutput text={output.preview} />
	{#if output.truncated}
		{#if canExpand && bridge && isNonEmptyString(output.outputRef)}
			<button
				type="button"
				class={cn(
					"mt-[8px] inline-flex items-center gap-[6px] rounded-[5px] border-0 bg-transparent px-[6px] py-[4px]",
					"text-[12px] text-muted",
					"hover:bg-settings-hover",
					"focus-visible:outline-1 focus-visible:outline-settings-focus",
				)}
				onclick={() => (expanded = !expanded)}
				aria-expanded={expanded}
				aria-controls={rangeId}
			>
				詳細出力 {#if expanded}<ChevronUp
						size={14}
						aria-hidden="true"
					/>{:else}<ChevronRight size={14} aria-hidden="true" />{/if}
			</button>
			{#if expanded}
				{#key output.outputRef}
					<OutputRange
						id={rangeId}
						outputRef={output.outputRef}
						{bridge}
					/>
				{/key}
			{/if}
		{:else}
			<p class="text-[12px] text-muted">
				省略部分の出力を取得できません。
			</p>
		{/if}
	{/if}
</section>
