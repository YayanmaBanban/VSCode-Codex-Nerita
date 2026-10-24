<!-- モデル・権限の段階選択と関連設定を、キーボードで操作できるカードにまとめる。 -->
<script lang="ts">
	import { Popover, mergeProps } from "bits-ui";
	import Bot from "@lucide/svelte/icons/bot";
	import User from "@lucide/svelte/icons/user";
	import Shield from "@lucide/svelte/icons/shield";
	import ShieldAlert from "@lucide/svelte/icons/shield-alert";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import Zap from "@lucide/svelte/icons/zap";
	import { cn } from "cnfast";
	import type { NeritaUiControl } from "@nerita/shared/uiContributions";
	import type { ConfigOption } from "@nerita/shared/composer";
	import Tooltip from "../ui/Tooltip.svelte";
	import StepSlider from "../ui/StepSlider.svelte";
	import ConfigControl from "../chat/composer/ConfigControl.svelte";
	import FastModeButton from "./FastModeButton.svelte";
	import { useSettingsPopup } from "../ui/settingsPopup.svelte";

	const popup = useSettingsPopup();
	let card = $state<HTMLDivElement | null>(null);
	let trigger = $state<HTMLButtonElement | null>(null);
	let returnFocus = false;

	let {
		control,
		disabled,
		onChange,
		outlined = false,
	}: {
		control: Extract<NeritaUiControl, { type: "slider-card" }>;
		disabled: boolean;
		onChange: (configId: string, value: string) => void;
		outlined?: boolean;
	} = $props();
	let preview = $state<number | null>(null);
	let option = $derived(control.option);
	let model = $derived(control.model);
	let displayed = $derived(
		preview === null
			? control
			: {
					...control,
					option: {
						...option,
						currentValue:
							option.options[preview]?.value ??
							option.currentValue,
					},
				},
	);
	let index = $derived(
		option.options.findIndex(
			(choice) => choice.value === option.currentValue,
		),
	);
	let label = $derived(optionLabel(option));
	let unavailable = $derived(
		disabled || (model ?? option).options.length === 0,
	);
	const descriptions: Record<string, string> = {
		low: "軽い推論。速度とコストを優先します。",
		medium: "品質と速度のバランスを取ります。",
		high: "複雑な実装やデバッグをより深く検討します。",
		xhigh: "難易度の高い実装やレビュー向けです。",
		max: "最難関の問題向けに推論能力を最大限使用します。",
		ultra: "複雑な作業を必要に応じて複数のエージェントへ委譲します。\n使用量が大きく増える場合があります。",
	};
	/** 未取得の選択値には設定名を表示する。 */
	function optionLabel(item: ConfigOption) {
		return (
			item.options.find((choice) => choice.value === item.currentValue)
				?.name ??
			item.currentLabel ??
			item.name
		);
	}
	/** 最初の補助ボタンではなく、カードの主操作へフォーカスを移す。 */
	function focusSlider(event: Event) {
		const slider = card?.querySelector<HTMLInputElement>(
			'input[type="range"]:not(:disabled)',
		);
		if (slider) {
			event.preventDefault();
			slider.focus({ preventScroll: true });
		}
	}
	/** カード切り替え時のフォーカスを奪わず、通常の閉じ操作ではスクロールせずに戻す。 */
	function restoreFocus(event: Event) {
		popup.onCloseAutoFocus(event);
		if (!event.defaultPrevented) {
			event.preventDefault();
			if (returnFocus) {
				trigger?.focus({ preventScroll: true });
			}
		}
		returnFocus = false;
	}
</script>

{#snippet tooltip()}
	{#if model}
		<span class="whitespace-pre-line"
			>{descriptions[option.currentValue]}</span
		>
	{:else}
		<span class="inline-flex items-center gap-[6px]"
			>{#if control.secondary}{#if control.secondary.icon === "user"}<User
						size={16}
						aria-hidden="true"
					/>{:else}<Bot size={16} aria-hidden="true" />{/if}{/if}<span
				>{label}</span
			></span
		>
	{/if}
{/snippet}
<Popover.Root bind:open={popup.open} onOpenChange={() => (preview = null)}>
	<Popover.Trigger>
		{#snippet child({ props: triggerProps })}
			<Tooltip
				content={tooltip}
				disabled={popup.open ||
					(model !== undefined &&
						descriptions[option.currentValue] === undefined)}
			>
				{#snippet children({ props: tooltipProps })}
					<button
						bind:this={trigger}
						{...mergeProps(
							{ ...triggerProps },
							{ ...tooltipProps },
						)}
						type="button"
						aria-label={model ? "モデルと推論レベル" : option.name}
						disabled={unavailable}
						class={cn(
							"inline-flex h-[28px] min-w-0 shrink items-center justify-center",
							"rounded-[5px] bg-transparent",
							outlined
								? "border border-solid border-input-border"
								: "border-0",
							"focus-visible:outline-1 focus-visible:outline-settings-focus",
							"enabled:hover:bg-settings-hover",
							"disabled:opacity-50",
							model
								? "gap-[6px] px-[5px] text-[12px] font-medium"
								: "w-[28px] shrink-0 p-0",
							control.warning === true
								? "text-warning"
								: "text-muted",
						)}
					>
						{#if model}<span class="truncate"
								><span
									class={cn(
										control.warning !== true &&
											"text-foreground",
									)}>{optionLabel(model)}</span
								>
								{optionLabel(option)}</span
							>{#if control.fastMode?.checked === true}<span
									aria-hidden="true"
									class="inline-flex shrink-0 [&_svg]:size-[14px]"
									><Zap
										size={14}
										color="#FACC15"
										fill="#FACC15"
									/></span
								>{/if}<ChevronDown
								size={12}
								class="shrink-0"
								aria-hidden="true"
							/>{:else if control.icon === "shield-alert"}<ShieldAlert
								size={16}
								aria-hidden="true"
							/>{:else}<Shield
								size={16}
								aria-hidden="true"
							/>{/if}</button
					>
				{/snippet}
			</Tooltip>
		{/snippet}
	</Popover.Trigger>
	<Popover.Portal>
		<Popover.Content
			bind:ref={card}
			onOpenAutoFocus={focusSlider}
			onCloseAutoFocus={restoreFocus}
			onEscapeKeydown={() => (returnFocus = true)}
			side="top"
			align="start"
			sideOffset={8}
			collisionPadding={12}
			aria-label={option.name}
			class={cn(
				"z-20 w-[min(256px,calc(100vw-24px))] rounded-[18px] border border-solid border-menu-border bg-menu",
				"p-[12px] text-menu-text shadow-[0_6px_24px_#0003]",
			)}
		>
			<div
				class="relative flex min-h-[36px] items-center justify-center pb-[8px]"
			>
				{#if displayed.fastMode}
					<div class="absolute top-0 left-0">
						<FastModeButton
							control={displayed.fastMode}
							{disabled}
							{onChange}
						/>
					</div>
				{/if}
				{#if displayed.secondary}
					<div class="absolute top-0 left-0">
						<ConfigControl
							option={displayed.secondary.option}
							icon={displayed.secondary.icon}
							{disabled}
							onChange={(value: string) => {
								if (displayed.secondary) {
									onChange(
										displayed.secondary.option.id,
										value,
									);
								}
							}}
						/>
					</div>
				{/if}
				<div class="flex min-w-0 flex-col items-center px-[28px]">
					<h2
						class={cn(
							"m-0 text-center text-[12px] font-medium",
							model && "text-link",
							control.warning === true && "text-warning",
						)}
					>
						{optionLabel(displayed.option)}
					</h2>
					{#if displayed.model}
						<ConfigControl
							option={displayed.model}
							chevron="right"
							{disabled}
							onChange={(value: string) => {
								if (displayed.model) {
									onChange(displayed.model.id, value);
								}
							}}
						/>
					{/if}
				</div>
			</div>
			<StepSlider
				value={Math.max(0, index)}
				count={option.options.length}
				label={option.name}
				valueText={optionLabel(displayed.option)}
				onPreview={(value: number | null) => (preview = value)}
				disabled={unavailable}
				onChange={(value: number) => {
					const choice = option.options[value];
					if (choice) {
						onChange(option.id, choice.value);
					}
				}}
			/>
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
