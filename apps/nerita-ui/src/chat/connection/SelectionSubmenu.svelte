<!-- 設定の型を保ちながらホバー待機とキーボード操作を共通のサブメニューで扱う。 -->
<script lang="ts" generics="Value extends string">
	import { cn } from "cnfast";
	import { DropdownMenu } from "bits-ui";
	import Check from "@lucide/svelte/icons/check";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import type { Snippet } from "svelte";

	let {
		label,
		icon,
		value,
		options,
		onSelect,
		disabled = false,
	}: {
		label: string;
		icon: Snippet;
		value: Value | undefined;
		options: readonly (readonly [Value, string])[];
		onSelect: (value: Value) => void;
		disabled?: boolean;
	} = $props();
	/** ライブラリーの値は公開された設定候補と一致した場合だけ渡す。 */
	function selectKnownOption(next: string) {
		const selected = options.find(([option]) => option === next);
		if (selected) {
			onSelect(selected[0]);
		}
	}
</script>

<DropdownMenu.Sub>
	<DropdownMenu.SubTrigger
		openDelay={300}
		class={cn(
			"flex cursor-pointer items-center gap-[8px] rounded-[4px] px-[10px] py-[8px] text-[12px] outline-none",
			"data-highlighted:bg-menu-hover",
		)}
		>{@render icon()}{label}<ChevronRight
			size={14}
			class="ml-auto"
			aria-hidden="true"
		/></DropdownMenu.SubTrigger
	>
	<DropdownMenu.Portal>
		<DropdownMenu.SubContent
			side="left"
			align="start"
			sideOffset={4}
			collisionPadding={8}
			class={cn(
				"z-30 min-w-[128px] rounded-[6px] border border-solid border-menu-border bg-menu p-[5px]",
				"text-menu-text shadow-[0_6px_24px_#0003]",
			)}
		>
			<DropdownMenu.RadioGroup
				value={value ?? ""}
				onValueChange={selectKnownOption}
			>
				{#each options as [option, name] (option)}
					<DropdownMenu.RadioItem
						value={option}
						{disabled}
						closeOnSelect
						class={cn(
							"flex cursor-pointer items-center gap-[8px] rounded-[4px] px-[10px] py-[8px] text-[12px] outline-none",
							"data-disabled:cursor-default data-disabled:opacity-50",
							"data-highlighted:bg-menu-hover",
						)}
					>
						{#snippet children({ checked })}<span
								class="size-[16px] shrink-0"
								>{#if checked}<Check
										size={16}
										class="text-menu-check"
										aria-hidden="true"
									/>{/if}</span
							>{name}{/snippet}
					</DropdownMenu.RadioItem>
				{/each}
			</DropdownMenu.RadioGroup>
		</DropdownMenu.SubContent>
	</DropdownMenu.Portal>
</DropdownMenu.Sub>
