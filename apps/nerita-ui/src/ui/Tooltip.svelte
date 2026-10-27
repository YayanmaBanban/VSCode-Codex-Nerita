<!-- 既存要素の操作を保ち、画面端を避けて説明を表示する。 -->
<script lang="ts">
	import { Tooltip, mergeProps } from "bits-ui";
	import { cn } from "cnfast";
	import type { Snippet } from "svelte";
	import { prefersReducedMotion } from "svelte/motion";
	import type { TransitionConfig } from "svelte/transition";
	import TooltipDomAnchor from "./TooltipDomAnchor.svelte";
	/** ツールチップとトリガーの表示契約。トリガーには受け取った属性を適用する。 */
	type Props = {
		children?: Snippet<[{ props: Record<string, unknown> }]>;
		externalTrigger?: HTMLElement;
		content?: string | Snippet | false | null | undefined;
		aboveMenu?: boolean;
		disabled?: boolean;
	};
	let {
		children,
		externalTrigger,
		content,
		aboveMenu = false,
		disabled = false,
	}: Props = $props();
	let trigger = $state<HTMLButtonElement | null>(null);
	let open = $state(false);
	let closedByScroll = false;
	let scrollSuppressed = $state(false);
	let suppressUntil = 0;
	const limited = $derived(
		typeof content === "string" && Array.from(content).length > 300
			? `${Array.from(content).slice(0, 300).join("")}…`
			: content,
	);
	const anchor = $derived(
		aboveMenu
			? (trigger?.closest<HTMLElement>(".config-popup") ?? trigger)
			: undefined,
	);
	/** 説明の拡大と不透明度を同時に変え、動きを減らす設定では即時表示する。 */
	function tooltipTransition(_node: HTMLElement): TransitionConfig {
		return {
			duration: prefersReducedMotion.current || closedByScroll ? 0 : 120,
			css: (t) => `opacity:${t};transform:scale(${0.95 + t * 0.05})`,
		};
	}
	/** 親が Escape の伝播を止める前に閉じ、履歴や検索欄の操作も続けられるようにする。 */
	function handleKeydown(event: KeyboardEvent) {
		if (open && event.key === "Escape") {
			open = false;
		}
	}
	/** 内側のスクロールも捕捉し、移動前の位置に説明が残らないよう即座に閉じる。 */
	function handleScroll() {
		closedByScroll = true;
		scrollSuppressed = true;
		suppressUntil = performance.now() + 150;
		open = false;
	}
	/** スクロール後の待機時間が過ぎたら、ポインター操作やフォーカスで再表示できるようにする。 */
	function resumeTooltip() {
		if (performance.now() >= suppressUntil) {
			scrollSuppressed = false;
		}
	}
	/** ブラウザーからスクロール終了の通知が来た場合は、次の操作を待機なしで受け付ける。 */
	function finishScroll() {
		suppressUntil = 0;
	}
	/** Bits UI が開く前に再操作を判定し、外部 DOM のトリガーにも同じ抑止を適用する。 */
	function triggerProps(props: Record<string, unknown>) {
		return mergeProps(
			{
				onpointerenter: resumeTooltip,
				onpointermove: resumeTooltip,
				onfocus: resumeTooltip,
			},
			props,
		);
	}
	/** 遅れて届く表示要求でも、画面やスクロール領域から外れた起点には表示しない。 */
	function triggerVisible() {
		const node = externalTrigger ?? trigger;
		if (!node) {
			return false;
		}
		const rect = node.getBoundingClientRect();
		const empty = rect.width === 0 || rect.height === 0;
		const outsideViewport =
			rect.bottom <= 0 || rect.top >= window.innerHeight;
		if (empty || outsideViewport) {
			return false;
		}
		return !clippedByParent(node, rect);
	}
	/** スクロール領域の外へ移動した起点を検出する。 */
	function clippedByParent(node: HTMLElement, rect: DOMRect) {
		for (
			let parent = node.parentElement;
			parent;
			parent = parent.parentElement
		) {
			const clips = /auto|scroll|hidden|clip/.test(
				getComputedStyle(parent).overflowY,
			);
			if (!clips) {
				continue;
			}
			const bounds = parent.getBoundingClientRect();
			if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) {
				return true;
			}
		}
		return false;
	}
</script>

<svelte:window onkeydowncapture={handleKeydown} />
<svelte:document
	onscrollcapture={handleScroll}
	onwheelcapture={handleScroll}
	onscrollendcapture={finishScroll}
/>
{#if content !== undefined && content !== null && content !== false}
	<Tooltip.Provider
		delayDuration={100}
		skipDelayDuration={0}
		ignoreNonKeyboardFocus
		disableHoverableContent
	>
		<Tooltip.Root
			bind:open={
				() => open && !disabled && !scrollSuppressed,
				(value: boolean) => {
					if (value && scrollSuppressed) {
						return;
					}
					if (value && !triggerVisible()) {
						return;
					}
					if (value) {
						closedByScroll = false;
					}
					open = value;
				}
			}
			disabled={disabled || scrollSuppressed}
		>
			<Tooltip.Trigger bind:ref={trigger}>
				{#snippet child({ props }: { props: Record<string, unknown> })}
					{#if externalTrigger}
						<TooltipDomAnchor
							element={externalTrigger}
							props={triggerProps(props)}
						/>
					{:else}
						{@render children?.({
							props: triggerProps(props),
						})}
					{/if}
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Content
					role="tooltip"
					side="top"
					sideOffset={8}
					collisionPadding={12}
					forceMount
					customAnchor={anchor ?? null}
					escapeKeydownBehavior="defer-otherwise-close"
					class={cn(
						"tooltip-positioner tooltip-content max-w-[min(280px,calc(100vw-24px))] rounded-[6px] border border-solid border-tooltip-border bg-tooltip px-[12px] py-[9px] text-[12px] leading-[1.5] [overflow-wrap:anywhere] text-tooltip-text shadow-[0_4px_16px_#0003] [&_hr]:mx-0 [&_hr]:my-[6px] [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-solid [&_hr]:border-tooltip-divider",
						aboveMenu ? "z-[60]" : "z-30",
					)}
				>
					{#snippet child({ wrapperProps, props, open: visible })}
						<div
							{...wrapperProps}
							style:visibility={scrollSuppressed
								? "hidden"
								: undefined}
						>
							{#if visible}
								<div {...props} transition:tooltipTransition>
									{#if typeof limited === "string"}
										<span class="whitespace-pre-wrap">
											{limited}
										</span>
									{:else}
										{#if limited}
											{@render limited()}
										{/if}
									{/if}
								</div>
							{/if}
						</div>
					{/snippet}
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip.Root>
	</Tooltip.Provider>
{:else}
	{@render children?.({ props: {} })}
{/if}
