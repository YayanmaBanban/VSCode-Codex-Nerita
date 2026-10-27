<!-- 削除操作をごみ箱アイコンで示し、ホバー時の赤い背景と共通ツールチップを提供する。 -->
<script lang="ts">
	import Trash from "@lucide/svelte/icons/trash";
	import { cn } from "cnfast";
	import Tooltip from "./Tooltip.svelte";

	let {
		label = "削除",
		ariaLabel = label,
		disabled = false,
		onDelete,
	}: {
		label?: string;
		ariaLabel?: string;
		disabled?: boolean;
		onDelete: () => void;
	} = $props();
</script>

<Tooltip content={label} {disabled}>
	{#snippet children({ props })}
		<button
			{...props}
			type="button"
			{disabled}
			aria-label={ariaLabel}
			onclick={onDelete}
			class={cn(
				"inline-flex size-8 shrink-0 items-center justify-center rounded-[5px] border-0 bg-transparent p-0 text-muted",
				"enabled:hover:bg-red-500/20 enabled:hover:text-red-500",
				"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-40",
			)}
		>
			<Trash size={15} aria-hidden="true" />
		</button>
	{/snippet}
</Tooltip>
