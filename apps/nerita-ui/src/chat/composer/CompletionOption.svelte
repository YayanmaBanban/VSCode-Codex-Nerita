<script lang="ts">
	import FolderOpen from "@lucide/svelte/icons/folder-open";
	import { cn } from "cnfast";
	import type { CompletionItem } from "./completionItems";
	import { contextCategories } from "./contextCategories";
	import { referenceIcon } from "./referencePresentation";
	import SettingsTooltip from "../SettingsTooltip.svelte";
	let {
		id,
		item,
		selected,
		context,
		onPick,
	}: {
		id: string;
		item: CompletionItem;
		selected: boolean;
		context: boolean;
		onPick: (item: CompletionItem) => void;
	} = $props();
	let Icon = $derived(completionIcon());
	function completionIcon() {
		if (!context) {
			return undefined;
		}
		if (item.reference) {
			return referenceIcon(item.reference);
		}
		if (item.directory) {
			return FolderOpen;
		}
		return contextCategories.find((entry) => entry.label === item.category)
			?.icon;
	}
	function selectKey(event: KeyboardEvent) {
		if (event.isComposing || item.disabled === true) {
			return;
		}
		if (event.key !== "Enter" && event.key !== " ") {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		pick();
	}
	function pick() {
		if (item.disabled !== true) {
			onPick(item);
		}
	}
</script>

<SettingsTooltip
	aboveMenu
	content={[item.label, item.description].filter(Boolean).join("\n")}
>
	{#snippet children({ props })}
		<div
			{...props}
			{id}
			role="option"
			tabindex={-1}
			aria-selected={selected}
			aria-label={item.category !== undefined && item.category !== ""
				? item.label
				: undefined}
			aria-disabled={item.disabled}
			onmousedown={(event) => event.preventDefault()}
			onkeydown={selectKey}
			onclick={pick}
			class={cn(
				"cursor-pointer rounded border border-transparent p-2 [overflow-wrap:anywhere]",
				context && "flex items-center gap-2",
				item.disabled === true && "cursor-not-allowed opacity-50",
				selected
					? "border-settings-focus bg-settings-hover"
					: "hover:bg-settings-hover",
			)}
		>
			{#if Icon}<Icon
					size={16}
					class="shrink-0"
					aria-hidden="true"
				/>{/if}
			<span
				class={cn(
					context && "min-w-0 text-[12px]",
					item.category !== undefined && item.category !== ""
						? "shrink-0"
						: "truncate",
				)}>{item.label}</span
			>
			{#if item.description}<span
					class={cn(
						"text-[12px] text-muted",
						context ? "min-w-0 truncate" : "line-clamp-2 block",
					)}>{item.description}</span
				>{/if}
		</div>
	{/snippet}
</SettingsTooltip>
