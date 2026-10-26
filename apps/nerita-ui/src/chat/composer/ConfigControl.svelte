<!-- 設定の選択肢を共通のメニューで表示し、現在値と選択項目の説明を利用側へ提供する。 -->
<script lang="ts">
	import { Select } from "bits-ui";
	import type { ConfigOption } from "@nerita/shared/composer";
	import Bot from "@lucide/svelte/icons/bot";
	import Check from "@lucide/svelte/icons/check";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import User from "@lucide/svelte/icons/user";
	import { cn } from "cnfast";
	import Tooltip from "../../ui/Tooltip.svelte";
	import { useSettingsPopup } from "../../ui/settingsPopup.svelte";

	const popup = useSettingsPopup();

	let {
		option,
		disabled,
		onChange,
		inDialog = false,
		icon,
		chevron = "down",
		appearance = "compact",
		disabledValues = [],
	}: {
		option: ConfigOption;
		disabled: boolean;
		onChange: (value: string) => void;
		inDialog?: boolean;
		icon?: "user" | "bot" | undefined;
		chevron?: "down" | "right";
		appearance?: "compact" | "field";
		disabledValues?: readonly string[];
	} = $props();
	let current = $derived(
		option.options.find((choice) => choice.value === option.currentValue),
	);
	let Icon = $derived(icon === "user" ? User : Bot);
	let Chevron = $derived(chevron === "right" ? ChevronRight : ChevronDown);
	let tooltip = $derived(controlTooltip());
	let hasTooltip = $derived(tooltip !== undefined && tooltip !== "");
	/** アイコンだけの操作には現在値を示し、通常の選択欄には候補の説明を表示する。 */
	function controlTooltip() {
		if (icon !== undefined) {
			return current?.name ?? option.currentValue;
		}
		return current?.description ?? option.description;
	}
</script>

<div
	class={cn(
		"config-control relative inline-flex max-w-full min-w-0",
		appearance === "field" ? "w-full text-foreground" : "text-muted",
	)}
>
	<Select.Root
		bind:open={popup.open}
		type="single"
		value={option.currentValue}
		disabled={disabled || option.options.length === 0}
		onValueChange={onChange}
	>
		<!-- 説明の有無が変わっても `Select.Trigger` を維持し、Select 内部の参照を失効させない。 -->
		<Tooltip content={tooltip ?? ""} disabled={popup.open || !hasTooltip}>
			{#snippet children({ props: triggerProps })}
				<Select.Trigger
					{...triggerProps}
					class={cn(
						"config-trigger inline-flex cursor-pointer items-center gap-[6px] rounded-[4px] [&_svg]:shrink-0",
						appearance === "field"
							? "min-h-[38px] w-full justify-between border border-solid border-input-border bg-transparent px-3 py-2"
							: "max-w-[170px]",
						appearance === "compact" &&
							(icon !== undefined
								? "border border-solid border-input-border bg-input px-[4px] py-[5px]"
								: "border-0 bg-transparent px-[5px] py-[6px]"),
						"text-[12px] text-ellipsis text-inherit focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-settings-focus focus-visible:outline-solid enabled:hover:bg-settings-hover",
					)}
					aria-label={option.name}
					role="combobox"
				>
					{#if icon !== undefined}
						<Icon size={16} aria-hidden="true" />
					{:else}
						<span class="truncate"
							>{current?.name ??
								option.currentLabel ??
								option.name}</span
						>
						<Chevron size={12} aria-hidden="true" />
					{/if}
				</Select.Trigger>
			{/snippet}
		</Tooltip>
		<Select.Portal>
			<Select.Content
				side="top"
				align="start"
				sideOffset={6}
				collisionPadding={12}
				class={cn(
					inDialog ? "z-[60]" : "z-20",
					"config-popup max-h-[min(340px,var(--bits-select-content-available-height))] w-[min(280px,calc(100vw-24px))] overflow-hidden rounded-[8px] border border-solid border-menu-border bg-menu text-menu-text shadow-[0_6px_24px_#0003]",
				)}
				aria-label={option.name}
			>
				<Select.Viewport
					class="config-list max-h-[inherit] scroll-p-[5px] overflow-y-auto p-[5px]"
				>
					{#each option.options as choice (choice.value)}
						<Tooltip
							content={choice.icon !== undefined
								? undefined
								: choice.description}
							aboveMenu
						>
							{#snippet children({ props: tooltipProps })}
								<Select.Item
									{...tooltipProps}
									value={choice.value}
									disabled={disabledValues.includes(
										choice.value,
									)}
									label={choice.name}
									aria-disabled={disabledValues.includes(
										choice.value,
									)}
									class={cn(
										"config-item flex min-h-[36px] cursor-pointer items-center justify-between gap-[12px] rounded-[5px]",
										"px-[10px] py-[8px] text-[12px] leading-[1.5]",
										"[overflow-wrap:anywhere]",
										"[outline:none]",
										"hover:bg-menu-hover",
										"data-highlighted:bg-menu-hover",
										"data-disabled:cursor-not-allowed data-disabled:opacity-50",
									)}
								>
									{#snippet children({ selected })}
										{#if choice.icon !== undefined}
											{@const ChoiceIcon =
												choice.icon === "user"
													? User
													: Bot}
											<span
												class="flex min-w-0 items-center gap-[10px]"
												><ChoiceIcon
													size={18}
													class="shrink-0"
													aria-hidden="true"
												/><span
													class="flex min-w-0 flex-col gap-[3px]"
													><span>{choice.name}</span
													><span
														class="text-[12px] whitespace-pre-line text-muted"
														>{choice.description}</span
													></span
												></span
											>
										{:else}
											<span>{choice.name}</span>
										{/if}
										<span
											class="config-check inline-flex flex-[0_0_15px] text-menu-check"
											>{#if selected}<Check
													size={15}
													aria-hidden="true"
												/>{/if}</span
										>
									{/snippet}
								</Select.Item>
							{/snippet}
						</Tooltip>
					{/each}
				</Select.Viewport>
			</Select.Content>
		</Select.Portal>
	</Select.Root>
</div>
