<!-- Host が解決した値を使い、バックエンドを判定しない設定スイッチを表示する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import { mergeProps } from "bits-ui";
	import type { NeritaUiControl } from "@nerita/shared/uiContributions";
	import Tooltip from "../ui/Tooltip.svelte";

	let {
		control,
		disabled,
		onChange,
	}: {
		control: Extract<NeritaUiControl, { type: "toggle" }>;
		disabled: boolean;
		onChange: (value: string) => void;
	} = $props();
</script>

<Tooltip content={control.description}>
	{#snippet children({ props })}
		<label
			class={cn(
				"toggle-switch inline-flex items-center gap-[5px] px-[5px] text-[12px]",
				"text-muted",
			)}
			><span>{control.label}</span><button
				{...mergeProps(
					{ ...props },
					{
						onclick: () =>
							onChange(
								control.checked
									? control.offValue
									: control.onValue,
							),
					},
				)}
				type="button"
				role="switch"
				class="group h-[15px] w-[26px] shrink-0 rounded-[12px] border-0 bg-switch-off p-[2px] aria-checked:bg-switch-on"
				aria-label={control.label}
				aria-checked={control.checked}
				disabled={disabled || control.disabled === true}
			>
				<span
					class="block size-[11px] rounded-full bg-foreground group-aria-checked:translate-x-[11px]"
				></span>
			</button></label
		>
	{/snippet}
</Tooltip>
