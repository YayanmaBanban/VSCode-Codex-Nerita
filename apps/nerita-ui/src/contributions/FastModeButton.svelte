<!-- モデルカードの速度設定を切り替え、状態に対応する同梱アイコンを表示する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import { mergeProps } from "bits-ui";
	import Zap from "@lucide/svelte/icons/zap";
	import type { NeritaUiControl } from "@nerita/shared/uiContributions";
	import SettingsTooltip from "../chat/SettingsTooltip.svelte";

	let {
		control,
		disabled,
		onChange,
	}: {
		control: NonNullable<
			Extract<NeritaUiControl, { type: "slider-card" }>["fastMode"]
		>;
		disabled: boolean;
		onChange: (configId: string, value: string) => void;
	} = $props();
</script>

<SettingsTooltip content="ファストモード&#10;速度1.5倍、使用量が増えます"
	>{#snippet children({ props })}<button
			{...mergeProps(
				{ ...props },
				{
					onclick: () =>
						onChange(
							control.configId,
							control.checked
								? control.offValue
								: control.onValue,
						),
				},
			)}
			type="button"
			role="switch"
			aria-label="ファストモード"
			aria-checked={control.checked}
			disabled={disabled || control.disabled}
			class={cn(
				"inline-flex size-[28px] items-center justify-center rounded-[5px] border",
				"border-solid border-input-border bg-input p-0 text-muted",
				"focus-visible:outline-1 focus-visible:outline-settings-focus",
				"enabled:hover:bg-settings-hover",
				"disabled:opacity-50",
			)}
			><span aria-hidden="true" class="inline-flex [&_svg]:size-[16px]"
				><Zap
					size={16}
					color={control.checked ? "#FACC15" : "currentColor"}
					fill={control.checked ? "#FACC15" : "none"}
				/></span
			></button
		>{/snippet}</SettingsTooltip
>
