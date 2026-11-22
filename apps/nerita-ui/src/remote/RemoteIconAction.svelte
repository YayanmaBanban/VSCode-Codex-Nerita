<!-- 変更ファイルの各操作を、アイコンとツールチップで表示する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import type Plus from "@lucide/svelte/icons/plus";
	import Tooltip from "../ui/Tooltip.svelte";

	let {
		label,
		glyph: Icon,
		disabled,
		onclick,
		accessibleName,
	}: {
		label: string;
		glyph: typeof Plus;
		disabled: boolean;
		onclick?: () => void;
		accessibleName?: string;
	} = $props();
</script>

<Tooltip content={label}>
	{#snippet children({ props })}
		<button
			{...props}
			type={onclick === undefined ? "submit" : "button"}
			class={cn(
				"grid size-[44px] place-items-center rounded-md border-0 p-0",
				"bg-transparent text-foreground enabled:hover:bg-settings-hover",
				"pointer-fine:size-8 pointer-fine:min-h-8 pointer-fine:min-w-8",
			)}
			aria-label={accessibleName ?? label}
			{disabled}
			{onclick}
		>
			<Icon size={16} aria-hidden="true" />
		</button>
	{/snippet}
</Tooltip>
