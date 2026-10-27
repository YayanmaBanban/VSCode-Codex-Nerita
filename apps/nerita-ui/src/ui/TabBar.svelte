<!-- 選択・ホバー・フォーカスの下線表示を揃え、収まらない横並びの項目を両端のボタンで送る。 -->
<script lang="ts" generics="T extends string">
	import ChevronsLeft from "@lucide/svelte/icons/chevrons-left";
	import ChevronsRight from "@lucide/svelte/icons/chevrons-right";
	import { cn } from "cnfast";

	let {
		label,
		items,
		value,
		onChange,
		disabled = false,
		orientation = "horizontal",
	}: {
		label: string;
		items: readonly {
			value: T;
			label: string;
			count?: number | undefined;
		}[];
		value: T;
		onChange: (value: T) => void;
		disabled?: boolean;
		orientation?: "horizontal" | "vertical";
	} = $props();
	let overflowing = $state(false);
	let atStart = $state(true);
	let atEnd = $state(true);
	let viewport: HTMLDivElement | undefined;
	const tabStyle = cn(
		"tab-button relative flex shrink-0 items-center gap-2 rounded-t-md border-0 bg-transparent px-4 py-2 text-sm font-medium whitespace-nowrap text-primary-text",
		"transition-colors duration-200 ease-out enabled:hover:bg-settings-hover motion-reduce:transition-none",
		"focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus",
		"disabled:cursor-not-allowed disabled:opacity-50",
	);
	const arrowStyle = cn(
		"m-1 inline-flex size-7 shrink-0 items-center justify-center rounded border border-input-border bg-blue-500 p-0 text-primary-text",
		"focus-visible:outline-2 focus-visible:outline-focus enabled:hover:bg-blue-400 disabled:opacity-40",
	);

	/** フォーカスや選択の移動では、ページ全体を動かさず項目の横方向だけを表示範囲へ戻す。 */
	function reveal(element: HTMLDivElement, target: Element | null) {
		if (orientation !== "horizontal" || target === null) {
			return;
		}
		const bounds = element.getBoundingClientRect();
		const item = target.getBoundingClientRect();
		if (item.left < bounds.left) {
			element.scrollLeft += item.left - bounds.left;
		} else if (item.right > bounds.right) {
			element.scrollLeft += item.right - bounds.right;
		}
	}

	/** 項目・選択・向きの変更時に DOM と同期し、幅の変更とスクロール位置を監視する。 */
	function attachViewport(element: HTMLDivElement) {
		// attachment の再評価で外部からの選択変更とラベル・件数の更新も反映する。
		void value;
		void items;
		void orientation;
		viewport = element;
		const container = element.parentElement;
		const content = element.firstElementChild;
		if (container === null || content === null) {
			return;
		}
		/** ボタンの有無に影響されない全幅であふれを判定し、両端への到達を更新する。 */
		const update = () => {
			overflowing =
				orientation === "horizontal" &&
				content.scrollWidth > container.clientWidth + 1;
			atStart = element.scrollLeft <= 1;
			atEnd =
				element.scrollLeft + element.clientWidth >=
				element.scrollWidth - 1;
		};
		const resize = new ResizeObserver(() => {
			reveal(element, element.querySelector('[aria-pressed="true"]'));
			update();
		});
		resize.observe(container);
		resize.observe(element);
		resize.observe(content);
		element.addEventListener("scroll", update);
		reveal(element, element.querySelector('[aria-pressed="true"]'));
		update();
		return () => {
			resize.disconnect();
			element.removeEventListener("scroll", update);
		};
	}

	/** 表示幅の大部分を送り、隣の項目との位置関係が分かる余地を残す。 */
	function scroll(direction: number) {
		if (viewport !== undefined) {
			viewport.scrollBy({
				left: direction * Math.max(80, viewport.clientWidth * 0.8),
			});
		}
	}
</script>

<nav
	aria-label={label}
	class={cn("flex min-h-0 min-w-0", orientation === "vertical" && "flex-col")}
>
	{#if overflowing}
		<button
			type="button"
			class={arrowStyle}
			aria-label="左のタブを表示"
			disabled={atStart}
			onclick={() => scroll(-1)}
		>
			<ChevronsLeft size={16} aria-hidden="true" />
		</button>
	{/if}
	<div
		class="tab-viewport min-h-0 min-w-0 flex-1 overflow-auto"
		{@attach attachViewport}
		onfocusin={(event) => {
			if (event.target instanceof Element) {
				reveal(event.currentTarget, event.target.closest("button"));
			}
		}}
	>
		<div
			class={cn(
				"flex gap-1",
				orientation === "vertical" ? "flex-col" : "w-max",
			)}
		>
			{#each items as item (item.value)}
				<button
					type="button"
					class={tabStyle}
					aria-pressed={value === item.value}
					{disabled}
					onclick={() => {
						if (value !== item.value) {
							onChange(item.value);
						}
					}}
				>
					<span>{item.label}</span>{#if item.count !== undefined}<span
							class="text-[12px] text-muted">{item.count}</span
						>{/if}
				</button>
			{/each}
		</div>
	</div>
	{#if overflowing}
		<button
			type="button"
			class={arrowStyle}
			aria-label="右のタブを表示"
			disabled={atEnd}
			onclick={() => scroll(1)}
		>
			<ChevronsRight size={16} aria-hidden="true" />
		</button>
	{/if}
</nav>

<style>
	.tab-viewport {
		scrollbar-width: none;
	}
	.tab-viewport::-webkit-scrollbar {
		display: none;
	}
	.tab-button::after {
		position: absolute;
		inset: auto 1rem 0;
		height: 2px;
		border-radius: 999px;
		background: currentColor;
		content: "";
		opacity: 0;
		transform: scaleX(0.5);
		transition:
			transform 200ms ease-out,
			opacity 200ms ease-out;
	}
	.tab-button[aria-pressed="true"]::after {
		background: var(--nerita-text-link-foreground);
		opacity: 1;
		transform: scaleX(1);
	}
	.tab-button:enabled:hover::after,
	.tab-button:focus-visible::after {
		opacity: 1;
		transform: scaleX(1);
	}
	@media (prefers-reduced-motion: reduce) {
		.tab-button::after {
			transition: none;
		}
	}
</style>
