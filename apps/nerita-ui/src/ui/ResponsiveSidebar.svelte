<!-- 広い画面では一覧を組み込み、狭い画面では小さなレールからモーダルで開く。 -->
<script lang="ts">
	import { tick, type Snippet } from "svelte";
	import { MediaQuery } from "svelte/reactivity";
	import { Dialog } from "bits-ui";
	import { cn } from "cnfast";
	import SidebarToggle from "./SidebarToggle.svelte";
	import SidebarContents from "./SidebarContents.svelte";

	let {
		label,
		header,
		expanded,
		collapsed,
		children,
	}: {
		label: string;
		header: Snippet;
		expanded: Snippet<[() => void]>;
		collapsed?: Snippet;
		children: Snippet;
	} = $props();
	const compact = new MediaQuery("(max-width: 759px)");
	let wideOpen = $state(true);
	let floatingOpen = $state(false);
	let trigger = $state<HTMLButtonElement>();
	let root: HTMLElement | undefined;
	/** 組み込み表示の切替後も、開閉操作からフォーカスを失わないようにする。 */
	function focusToggle() {
		root?.querySelector<HTMLButtonElement>("aside button")?.focus({
			preventScroll: true,
		});
	}
	/** 開閉後のフォーカス先をこのコンポーネントの中に限定する。 */
	function attachRoot(node: HTMLElement) {
		root = node;
		return () => {
			root = undefined;
		};
	}
	/** 一覧選択後は狭い画面のパネルだけを閉じ、開くボタンへフォーカスを戻す。 */
	function closeFloating() {
		floatingOpen = false;
		trigger?.focus({ preventScroll: true });
	}
	/** 表示方式に対応する開閉状態を切り替える。 */
	function toggle() {
		if (compact.current) {
			floatingOpen = !floatingOpen;
		} else {
			wideOpen = !wideOpen;
			void tick().then(focusToggle);
		}
	}
</script>

<div
	{@attach attachRoot}
	class="sidebar-layout grid min-h-0 min-w-0 flex-1"
	data-expanded={!compact.current && wideOpen}
>
	<aside
		aria-label={label}
		class={cn(
			"min-h-0 min-w-0 self-stretch",
			!compact.current && wideOpen && "border-r border-input-border",
		)}
	>
		<div
			class="sidebar-sticky sticky top-6 flex min-h-0 min-w-0 flex-col gap-2"
		>
			{#if compact.current || !wideOpen}
				<SidebarToggle
					open={false}
					onToggle={toggle}
					bind:button={trigger}
				/>
				{#if collapsed}
					{@render collapsed()}
				{/if}
			{:else}
				<div class="sidebar-panel box-border flex min-h-0 flex-col">
					<SidebarContents
						{header}
						{expanded}
						onToggle={toggle}
						onSelect={closeFloating}
					/>
				</div>
			{/if}
		</div>
	</aside>
	<section class="sidebar-content min-h-0 min-w-0">
		{@render children()}
	</section>
</div>
<Dialog.Root
	bind:open={
		() => compact.current && floatingOpen,
		(value: boolean) => {
			floatingOpen = value;
			if (!value) {
				trigger?.focus({ preventScroll: true });
			}
		}
	}
>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-30 bg-black/30" />
		<Dialog.Content
			class={cn(
				"sidebar-floating fixed inset-y-4 left-4 z-40 flex w-[min(280px,calc(100vw-32px))] flex-col",
				"rounded-lg border border-menu-border bg-menu p-4 text-menu-text shadow-xl",
			)}
		>
			<Dialog.Title class="sr-only">{label}</Dialog.Title>
			<Dialog.Description class="sr-only">
				検索して編集する項目を選択してください。
			</Dialog.Description>
			<SidebarContents
				{header}
				{expanded}
				onToggle={toggle}
				onSelect={closeFloating}
			/>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.sidebar-layout {
		/* 項目数が増えても行を親の高さに収め、スクロールを一覧へ委ねる。 */
		grid-template-rows: minmax(0, 1fr);
		gap: var(--sidebar-gap, 16px);
		grid-template-columns: 32px minmax(0, 1fr);
		transition: grid-template-columns 220ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.sidebar-layout[data-expanded="true"] {
		grid-template-columns: var(--sidebar-expanded-width, 240px) minmax(
				0,
				1fr
			);
	}
	.sidebar-panel {
		padding: var(--sidebar-panel-padding, 0 16px 0 0);
		height: var(
			--sidebar-panel-height,
			calc(100dvh - 190px - var(--settings-footer-height, 0px))
		);
		overflow: hidden;
		animation: sidebar-appear 180ms ease-out;
	}
	.sidebar-sticky {
		height: var(--sidebar-panel-height, auto);
	}
	.sidebar-content {
		overflow: var(--sidebar-content-overflow, visible);
		padding: var(--sidebar-content-padding, 0);
	}
	:global(.sidebar-floating[data-state="open"]) {
		animation: sidebar-slide 220ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	:global(.sidebar-floating[data-state="closed"]) {
		animation: sidebar-slide 160ms ease-in reverse;
	}
	@keyframes sidebar-appear {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes sidebar-slide {
		from {
			opacity: 0;
			transform: translateX(-24px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sidebar-layout {
			transition: none;
		}
		.sidebar-panel,
		:global(.sidebar-floating) {
			animation: none !important;
		}
	}
</style>
