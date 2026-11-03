<!-- 検索・選択中の表示・任意の長押し削除を、開閉できるサイドバーと編集領域で共有する。 -->
<script module lang="ts">
	/** id は一覧内で一意にする。key は編集可能な ID と項目の寿命を分ける場合に指定する。 */
	export type SidebarItem = {
		id: string;
		name: string;
		description: string;
		key?: object;
	};
</script>

<script lang="ts">
	import type { Snippet } from "svelte";
	import ArrowRight from "@lucide/svelte/icons/arrow-right";
	import { fly } from "svelte/transition";
	import { cubicIn, cubicOut } from "svelte/easing";
	import { prefersReducedMotion } from "svelte/motion";
	import { cn } from "cnfast";
	import { mergeProps } from "bits-ui";
	import Tooltip from "./Tooltip.svelte";
	import HoldToDeleteButton from "./HoldToDeleteButton.svelte";
	import ResponsiveSidebar from "./ResponsiveSidebar.svelte";
	import SelectionSearchPanel from "./SelectionSearchPanel.svelte";

	let {
		items,
		selected,
		onSelect,
		label,
		title = label,
		disabled = false,
		pinnedItem,
		pinnedIcon,
		showDelete = false,
		onDelete,
		deleteLabel = (item: SidebarItem) => `${item.name}を削除`,
		deleteTooltip = "長押しで削除",
		emptyMessage = `${label}がありません。`,
		noResultsMessage = `一致する${label}がありません。`,
		children: content,
	}: {
		items: SidebarItem[];
		selected: string;
		onSelect: (id: string) => void;
		label: string;
		title?: string;
		disabled?: boolean;
		pinnedItem?: SidebarItem | undefined;
		pinnedIcon?: Snippet;
		showDelete?: boolean;
		onDelete?: (id: string) => void;
		deleteLabel?: (item: SidebarItem) => string;
		deleteTooltip?: string;
		emptyMessage?: string;
		noResultsMessage?: string;
		children: Snippet;
	} = $props();
	let query = $state("");
	let holding = $state<string>();
	let filtered = $derived(
		items.filter((item) =>
			`${item.id} ${item.name} ${item.description}`
				.toLowerCase()
				.includes(query.trim().toLowerCase()),
		),
	);
	let selectedItem = $derived(items.find((item) => item.id === selected));
	const itemStyle = cn(
		"relative flex w-full min-w-0 items-center gap-2 rounded-sm border-0 bg-transparent py-2 text-left break-words text-primary-text",
		"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus enabled:hover:bg-settings-hover",
		"aria-[current=page]:bg-settings-hover aria-[current=page]:font-semibold",
		"disabled:cursor-not-allowed disabled:opacity-50",
	);
</script>

<ResponsiveSidebar label={`${label}のサイドバー`}>
	{#snippet collapsed()}
		<SelectionSearchPanel
			{label}
			{items}
			{selected}
			bind:query
			{disabled}
			{onSelect}
			emptyMessage={items.length === 0 ? emptyMessage : noResultsMessage}
		/>
	{/snippet}
	{#snippet header()}
		<input
			type="search"
			{disabled}
			aria-label={`${label}を検索`}
			placeholder={`${label}を検索`}
			bind:value={query}
			class={cn(
				"w-full min-w-0 rounded-none border border-input-border bg-input px-3 py-2 text-sm text-foreground",
				"outline-none focus-visible:ring-2 focus-visible:ring-focus",
			)}
		/>
	{/snippet}
	{#snippet expanded(close: () => void)}
		<nav
			aria-label={title}
			class="flex min-h-0 min-w-0 flex-1 flex-col gap-4"
		>
			{#if pinnedItem}
				<div class="shrink-0 border-b border-input-border pb-4">
					<Tooltip content={pinnedItem.description}>
						{#snippet children({ props })}
							<button
								{...mergeProps(props, {
									onclick: () => {
										onSelect(pinnedItem.id);
										close();
									},
								})}
								type="button"
								{disabled}
								aria-current={selected === pinnedItem.id
									? "page"
									: undefined}
								class={cn(
									itemStyle,
									"px-2 text-xs font-semibold",
								)}
							>
								{#if pinnedIcon}
									{@render pinnedIcon()}
								{/if}
								<span>{pinnedItem.name}</span>
							</button>
						{/snippet}
					</Tooltip>
				</div>
			{/if}
			{#if selectedItem}
				<div
					role="region"
					aria-label={`選択中の${label}`}
					class="flex shrink-0 items-center justify-between gap-2 border-b border-input-border px-2 pb-4 text-sm font-semibold"
					in:fly={{
						y: -4,
						duration: prefersReducedMotion.current ? 0 : 200,
						easing: cubicIn,
					}}
					out:fly={{
						y: -4,
						duration: prefersReducedMotion.current ? 0 : 160,
						easing: cubicOut,
					}}
				>
					<span class="min-w-0 break-words">
						{selectedItem.name}
					</span>
					<ArrowRight size={16} class="shrink-0" aria-hidden="true" />
				</div>
			{/if}

			<div
				class="flex shrink-0 items-center justify-between gap-2 px-2 text-xs"
			>
				<h2 class="m-0 text-xs font-medium">{title}</h2>
				<span class="text-muted" aria-label={`表示中の${label}数`}
					>{filtered.length} / {items.length}</span
				>
			</div>
			<!-- 揺れと外側のフォーカス枠が一覧の端で切れないよう、スクロール領域の内側に余白を取る。 -->
			<div
				role="region"
				aria-label={`${label}一覧`}
				class={cn(
					"grid min-h-0 min-w-0 flex-1 content-start gap-[5px] p-1.5",
					"[scrollbar-gutter:stable] overflow-x-hidden overflow-y-auto overscroll-contain",
				)}
			>
				{#each filtered as item (item.key ?? item.id)}
					<div
						class={cn(
							"flex min-w-0 items-center gap-1 rounded-sm",
							selected === item.id && "bg-settings-hover",
						)}
					>
						<Tooltip content={item.description}>
							{#snippet children({ props })}
								<button
									{...mergeProps(props, {
										onclick: () => {
											onSelect(item.id);
											close();
										},
									})}
									type="button"
									{disabled}
									aria-current={selected === item.id
										? "page"
										: undefined}
									class={cn(
										"relative flex w-full min-w-0 items-center gap-2 rounded-sm border-0 bg-transparent py-2 pr-2 pl-5 text-left text-sm break-words text-primary-text",
										"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus enabled:hover:bg-settings-hover",
										"disabled:cursor-not-allowed disabled:opacity-50 aria-[current=page]:font-semibold",
									)}
								>
									<span
										aria-hidden="true"
										class={cn(
											"absolute inset-y-2 left-2 w-[3px] rounded-full bg-focus",
											selected !== item.id && "invisible",
										)}
									></span>
									<span
										class="min-w-0 [overflow-wrap:anywhere]"
									>
										{item.name}
									</span>
								</button>
							{/snippet}
						</Tooltip>
						{#if showDelete && onDelete !== undefined}
							<Tooltip
								content={deleteTooltip}
								disabled={holding === item.id}
							>
								{#snippet children({ props: triggerProps })}
									<HoldToDeleteButton
										label={deleteLabel(item)}
										{disabled}
										{triggerProps}
										bind:holding={
											() => holding === item.id,
											(value: boolean) => {
												holding = value
													? item.id
													: undefined;
											}
										}
										onDelete={() => onDelete?.(item.id)}
									/>
								{/snippet}
							</Tooltip>
						{/if}
					</div>
				{/each}
				{#if filtered.length === 0}
					<p class="m-0 px-2 py-2 text-sm text-muted">
						{items.length === 0 ? emptyMessage : noResultsMessage}
					</p>
				{/if}
			</div>
		</nav>
	{/snippet}
	{@render content()}
</ResponsiveSidebar>
