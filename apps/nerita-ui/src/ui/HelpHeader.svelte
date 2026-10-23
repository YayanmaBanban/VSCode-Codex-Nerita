<!-- 見出し横のヘルプボタンと、説明欄の開閉表示を共有する。 -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import CircleQuestionMark from "@lucide/svelte/icons/circle-question-mark";
	import { cn } from "cnfast";
	import SettingsTooltip from "../chat/SettingsTooltip.svelte";

	let {
		title,
		heading = "h2",
		helpLabel,
		disabled = false,
		actions,
		children,
	}: {
		title: string;
		heading?: "h1" | "h2";
		helpLabel: string;
		disabled?: boolean;
		actions?: Snippet;
		children: Snippet;
	} = $props();
	let expanded = $state(false);
	const helpId = $props.id();
</script>

<header>
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex items-center gap-1">
			<svelte:element this={heading} class="m-0 text-lg font-semibold"
				>{title}</svelte:element
			>
			<SettingsTooltip content="ヘルプ">
				{#snippet children({ props })}
					<button
						{...props}
						type="button"
						{disabled}
						class={cn(
							"inline-flex size-7 items-center justify-center rounded border-0 bg-transparent p-0 text-muted",
							"hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus enabled:hover:bg-settings-hover",
						)}
						aria-label={helpLabel}
						aria-expanded={expanded}
						aria-controls={helpId}
						onclick={() => (expanded = !expanded)}
					>
						<CircleQuestionMark
							size={16}
							class="mt-0.5"
							aria-hidden="true"
						/>
					</button>
				{/snippet}
			</SettingsTooltip>
		</div>
		{#if actions}{@render actions()}{/if}
	</div>
	<div
		id={helpId}
		class="header-help"
		data-expanded={expanded}
		aria-hidden={!expanded}
		inert={!expanded}
	>
		<div class="min-h-0 overflow-hidden">
			<div class="pt-3 text-xs text-[12px] leading-relaxed text-muted">
				{@render children()}
			</div>
		</div>
	</div>
</header>

<style>
	/* 折り返しに追従し、閉じる途中でも再度開けるよう DOM を保持する。 */
	.header-help {
		display: grid;
		grid-template-rows: 0fr;
		transition: grid-template-rows 240ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.header-help[data-expanded="true"] {
		grid-template-rows: 1fr;
	}
	@media (prefers-reduced-motion: reduce) {
		.header-help {
			transition: none;
		}
	}
</style>
