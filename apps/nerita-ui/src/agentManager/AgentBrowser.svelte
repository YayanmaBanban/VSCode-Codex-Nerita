<!-- 共通設定を固定項目に分け、検索できるエージェント一覧と編集欄を並べる。 -->
<script lang="ts">
	import type { Snippet } from "svelte";
	import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
	import ArrowRight from "@lucide/svelte/icons/arrow-right";
	import { fly } from "svelte/transition";
	import { cubicIn, cubicOut } from "svelte/easing";
	import { prefersReducedMotion } from "svelte/motion";
	import { cn } from "cnfast";
	import { mergeProps } from "bits-ui";
	import type { ManagedAgent } from "@nerita/shared/agentManager/messages";
	import SettingsTooltip from "../chat/SettingsTooltip.svelte";

	let {
		agents,
		selected,
		onSelect,
		busy,
		defaults = false,
		children,
	}: {
		agents: ManagedAgent[];
		selected: string;
		onSelect: (id: string) => void;
		busy: boolean;
		defaults?: boolean;
		children: Snippet;
	} = $props();
	let query = $state("");
	let items = $derived([
		...agents,
		...(selected === "new"
			? [{ id: "new", name: "新しい Agent", description: "未保存の定義" }]
			: []),
	]);
	let filtered = $derived(
		items.filter((item) =>
			`${item.name} ${item.description}`
				.toLowerCase()
				.includes(query.trim().toLowerCase()),
		),
	);
	let selectedAgent = $derived(items.find((item) => item.id === selected));
	const itemStyle = cn(
		"relative flex w-full min-w-0 items-center gap-2 rounded-sm border-0 bg-transparent py-2 text-left break-words",
		"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus enabled:hover:bg-settings-hover",
		"aria-[current=page]:bg-settings-hover aria-[current=page]:font-semibold",
		"disabled:cursor-not-allowed disabled:opacity-50",
	);
	/** サイドバーの上端位置を高さの計算に使い、画面下部に余分な隙間ができるのを防ぐ。 */
	function fillHeight(node: HTMLElement) {
		/** スクロールや見出しの折り返しで位置が変わっても、利用できる高さを計算し直せるようにする。 */
		const update = () => {
			const top = `${Math.max(0, node.getBoundingClientRect().top)}px`;
			if (node.style.getPropertyValue("--agent-browser-top") !== top) {
				node.style.setProperty("--agent-browser-top", top);
			}
		};
		const observer = new ResizeObserver(update);
		observer.observe(node);
		observer.observe(document.body);
		window.addEventListener("resize", update);
		document.addEventListener("scroll", update, true);
		update();
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", update);
			document.removeEventListener("scroll", update, true);
			node.style.removeProperty("--agent-browser-top");
		};
	}
</script>

<div class="grid min-w-0 items-start gap-6 sm:grid-cols-[210px_minmax(0,1fr)]">
	<aside
		{@attach fillHeight}
		class={cn(
			"grid min-w-0 gap-4 border-b border-input-border pb-4",
			"sm:sticky sm:top-6 sm:h-[calc(100dvh-var(--agent-browser-top)-var(--settings-footer-height,0px)-16px)] sm:grid-rows-[auto_minmax(0,1fr)] sm:border-r sm:border-b-0 sm:pr-4 sm:pb-0",
		)}
	>
		<input
			type="search"
			disabled={busy}
			aria-label="エージェントを検索"
			placeholder="エージェントを検索"
			bind:value={query}
			class={cn(
				"w-full min-w-0 rounded-none border border-input-border bg-input px-3 py-2 text-sm text-foreground",
				"outline-none focus-visible:ring-2 focus-visible:ring-focus",
			)}
		/>
		<nav aria-label="Agents" class="flex min-h-0 min-w-0 flex-col gap-4">
			{#if defaults}
				<div class="shrink-0 border-b border-input-border pb-4">
					<SettingsTooltip content="プロジェクト共通の設定">
						{#snippet children({ props })}
							<button
								{...mergeProps(props, {
									onclick: () => onSelect("defaults"),
								})}
								type="button"
								disabled={busy}
								aria-current={selected === "defaults"
									? "page"
									: undefined}
								class={cn(
									itemStyle,
									"px-2 text-xs font-semibold",
								)}
							>
								<SlidersHorizontal
									size={14}
									class="shrink-0 text-muted"
									aria-hidden="true"
								/>
								<span>Workspace defaults</span>
							</button>
						{/snippet}
					</SettingsTooltip>
				</div>
			{/if}
			{#if selectedAgent}
				<div
					role="region"
					aria-label="選択中のエージェント"
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
					<span class="min-w-0 break-words">{selectedAgent.name}</span
					>
					<ArrowRight size={16} class="shrink-0" aria-hidden="true" />
				</div>
			{/if}
			<div
				class="flex shrink-0 items-center justify-between gap-2 px-2 text-xs"
			>
				<h2 class="m-0 text-xs font-medium">Agents</h2>
				<span class="text-muted" aria-label="表示中のエージェント数"
					>{filtered.length} / {items.length}</span
				>
			</div>
			<div
				role="region"
				aria-label="エージェント一覧"
				class={cn(
					"grid max-h-[min(45dvh,360px)] min-w-0 content-start gap-[5px] overflow-y-auto overscroll-contain py-1",
					"sm:max-h-none sm:min-h-0 sm:flex-1",
				)}
			>
				{#each filtered as item (item.id)}
					<SettingsTooltip content={item.description}>
						{#snippet children({ props })}
							<button
								{...mergeProps(
									{ ...props },
									{
										onclick: () => onSelect(item.id),
									},
								)}
								type="button"
								disabled={busy}
								aria-current={selected === item.id
									? "page"
									: undefined}
								class={cn(itemStyle, "pr-2 pl-5 text-sm")}
								><span
									aria-hidden="true"
									class={cn(
										"absolute inset-y-2 left-2 w-[3px] rounded-full bg-focus",
										selected !== item.id && "invisible",
									)}
								></span><span class="min-w-0 break-words"
									>{item.name}</span
								></button
							>
						{/snippet}
					</SettingsTooltip>
				{/each}
				{#if filtered.length === 0}
					<p class="m-0 px-2 py-2 text-sm text-muted">
						{items.length === 0
							? "Agent 定義がありません。"
							: "一致するエージェントがありません。"}
					</p>
				{/if}
			</div>
		</nav>
	</aside>
	<section class="min-w-0">
		{@render children()}
	</section>
</div>
