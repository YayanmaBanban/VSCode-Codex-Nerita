<!-- サイドバーの開閉操作とホバー時のアイコン、ツールチップを揃える。 -->
<script lang="ts">
	import { mergeProps } from "bits-ui";
	import PanelLeft from "@lucide/svelte/icons/panel-left";
	import PanelLeftClose from "@lucide/svelte/icons/panel-left-close";
	import PanelLeftOpen from "@lucide/svelte/icons/panel-left-open";
	import { cn } from "cnfast";
	import Tooltip from "./Tooltip.svelte";

	let {
		open,
		onToggle,
		button = $bindable(),
	}: {
		open: boolean;
		onToggle: () => void;
		button?: HTMLButtonElement | undefined;
	} = $props();
</script>

<Tooltip content={open ? "サイドバーを閉じる" : "サイドバーを開く"} aboveMenu>
	{#snippet children({ props })}
		<button
			{...mergeProps(props, { onclick: onToggle })}
			bind:this={button}
			type="button"
			aria-label={open ? "サイドバーを閉じる" : "サイドバーを開く"}
			aria-expanded={open}
			class={cn(
				"group inline-flex size-8 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0",
				"hover:bg-settings-hover focus-visible:outline-2 focus-visible:outline-focus",
			)}
		>
			{#if open}
				<PanelLeft
					size={16}
					aria-hidden="true"
					class="group-hover:hidden group-focus-visible:hidden"
				/>
				<PanelLeftClose
					size={16}
					aria-hidden="true"
					class="hidden group-hover:block group-focus-visible:block"
				/>
			{:else}
				<PanelLeftOpen size={16} aria-hidden="true" />
			{/if}
		</button>
	{/snippet}
</Tooltip>
