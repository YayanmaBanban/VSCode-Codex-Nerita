<script lang="ts">
	import { onMount } from "svelte";
	import { cn } from "cnfast";
	import type { CompletionMenuProps } from "./completionMenuProps";
	import CompletionOption from "./CompletionOption.svelte";
	let {
		id,
		title,
		query,
		items,
		selected,
		empty,
		onQuery,
		onKeyDown,
		onPick,
		location,
		notice,
		header,
		context = false,
		autoFocus = false,
	}: CompletionMenuProps = $props();
	let list: HTMLDivElement | undefined = $state();
	let panel: HTMLDivElement | undefined = $state();
	let input: HTMLInputElement | undefined = $state();
	let above = $state(true);
	function position() {
		if (panel) {
			above =
				(panel.parentElement?.getBoundingClientRect().top ?? 0) >=
				panel.offsetHeight + 12;
		}
	}
	function positionFor(_count: number, _title: string) {
		position();
	}
	// 候補や見出しの変更後に DOM の高さを測り、パネルを置ける側を決める。
	$effect(() => {
		positionFor(items.length, title);
	});
	// キー操作で選ばれた候補を、DOM の更新後に表示領域へスクロールする。
	$effect(() =>
		list?.children[selected]?.scrollIntoView({ block: "nearest" }),
	);
	onMount(() => {
		if (autoFocus) {
			input?.focus({ preventScroll: true });
		}
	});
</script>

<svelte:window onresize={position} />
<div
	bind:this={panel}
	class={cn(
		"absolute left-0 z-50 flex max-h-[min(560px,80dvh)] min-w-0 flex-col overflow-y-auto rounded-[6px] border border-panel-border bg-input p-2 shadow-lg",
		context ? "w-[min(460px,calc(100vw-54px))]" : "w-full",
		above ? "bottom-full mb-2" : "top-0",
	)}
	role="region"
	aria-label={title}
>
	{@render header?.()}
	<div
		class={cn(
			"flex shrink-0 items-center gap-2",
			context
				? "order-last mt-2 border-t border-panel-border pt-2"
				: "mb-2 border-b border-panel-border pb-2",
		)}
	>
		<input
			bind:this={input}
			aria-label={`${title}を検索`}
			role="combobox"
			aria-expanded="true"
			aria-controls={id}
			aria-activedescendant={items[selected]
				? `${id}-${selected}`
				: undefined}
			value={query}
			oninput={(event) => onQuery(event.currentTarget.value)}
			onkeydown={onKeyDown}
			placeholder={location !== undefined && location !== ""
				? "この階層を検索"
				: `${title}を検索`}
			class="w-full min-w-0 rounded border border-input-border bg-input p-2 text-input-text focus:outline-2 focus:outline-focus"
		/>
	</div>
	{#if location}<p class="mb-2 text-[12px] break-all text-muted">
			{location}
		</p>{/if}
	{#if notice}<p role="status" class="mb-2 text-[12px] text-muted">
			{notice}
		</p>{/if}
	<div
		bind:this={list}
		{id}
		role="listbox"
		aria-label={title}
		class="max-h-[min(240px,35vh)] overflow-y-auto"
	>
		{#each items as item, index (item.id)}<CompletionOption
				id={`${id}-${index}`}
				{item}
				selected={index === selected}
				{context}
				{onPick}
			/>{/each}
		{#if items.length === 0}<p
				class="p-2 text-[12px] text-muted"
				role="status"
			>
				{empty}
			</p>{/if}
	</div>
</div>
