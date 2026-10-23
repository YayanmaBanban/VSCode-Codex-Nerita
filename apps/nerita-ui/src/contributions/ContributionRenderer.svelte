<!-- バックエンドを判定せず、検証済みのコントロール種別に従って描画する。 -->
<script lang="ts">
	import type { NeritaUiControl } from "@nerita/shared/uiContributions";
	import ToggleSwitch from "./ToggleSwitch.svelte";
	import SliderCard from "./SliderCard.svelte";
	import ConfigControl from "../chat/composer/ConfigControl.svelte";
	import SettingsTooltip from "../chat/SettingsTooltip.svelte";
	import QuotaBar from "../chat/composer/QuotaBar.svelte";

	let {
		control,
		disabled,
		onChange,
	}: {
		control: NeritaUiControl;
		disabled: boolean;
		onChange: (configId: string, value: string) => void;
	} = $props();
	let progressValue = $derived(
		control.type === "progress" ? control.value : 0,
	);
</script>

{#if control.type === "slider-card"}
	<SliderCard
		{control}
		disabled={disabled || control.disabled === true}
		{onChange}
	/>
{:else}
	{#if control.type === "quota"}
		<QuotaBar windows={control.windows} />
	{:else}
		{#if control.type === "select"}
			<ConfigControl
				option={control.option}
				disabled={disabled || control.disabled === true}
				onChange={(value: string) => {
					onChange(control.option.id, value);
				}}
			/>
		{:else}
			{#if control.type === "toggle"}
				<ToggleSwitch
					{control}
					{disabled}
					onChange={(value: string) => {
						onChange(control.configId, value);
					}}
				/>
			{:else}
				<SettingsTooltip content={control.description}>
					{#snippet children({ props })}
						<div
							{...props}
							class="inline-flex max-w-full min-w-0 items-center gap-[5px] px-[5px] text-[12px] text-muted"
						>
							<span class="truncate">{control.label}</span>
							<progress
								aria-label={control.label}
								value={control.value}
								max={100}
								class="h-[5px] w-[48px] shrink-0 accent-current"
							></progress>
							<span>{Math.round(progressValue)}%</span>
						</div>
					{/snippet}
				</SettingsTooltip>
			{/if}
		{/if}
	{/if}
{/if}
