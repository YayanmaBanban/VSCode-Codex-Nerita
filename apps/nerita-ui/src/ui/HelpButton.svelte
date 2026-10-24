<!-- ヘルプアイコンと読み上げ名を持つボタンから、共通ツールチップで説明を表示する。 -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import CircleQuestionMark from "@lucide/svelte/icons/circle-question-mark";
	import { cn } from "cnfast";
	import Tooltip from "./Tooltip.svelte";

	let {
		label = "ヘルプ",
		content,
		aboveMenu = false,
		disabled = false,
	}: {
		label?: string;
		content: string | Snippet;
		aboveMenu?: boolean;
		disabled?: boolean;
	} = $props();
</script>

<Tooltip {content} {aboveMenu} {disabled}>
	{#snippet children({ props })}
		<button
			{...props}
			type="button"
			{disabled}
			aria-label={label}
			class={cn(
				"inline-flex size-7 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 text-muted",
				"hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus enabled:hover:bg-settings-hover",
			)}
		>
			<CircleQuestionMark size={16} aria-hidden="true" />
		</button>
	{/snippet}
</Tooltip>
