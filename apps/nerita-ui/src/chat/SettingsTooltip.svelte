<!-- 既存要素の操作を保ち、画面端を避けて説明を表示する。 -->
<script lang="ts">
	import { Tooltip } from "bits-ui";
	import { cn } from "cnfast";
	import type { Snippet } from "svelte";
	import { prefersReducedMotion } from "svelte/motion";
	import type { TransitionConfig } from "svelte/transition";
	/** ツールチップとトリガーの表示契約。トリガーには受け取った属性を適用する。 */
	type Props = {
		children: Snippet<[{ props: Record<string, unknown> }]>;
		content?: string | Snippet | false | null | undefined;
		aboveMenu?: boolean;
	};
	let { children, content, aboveMenu = false }: Props = $props();
	let trigger = $state<HTMLButtonElement | null>(null);
	let open = $state(false);
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
			duration: prefersReducedMotion.current ? 0 : 120,
			css: (t) => `opacity:${t};transform:scale(${0.95 + t * 0.05})`,
		};
	}
	/** ツールチップを閉じても、履歴や検索欄の Escape 操作へイベントを届ける。 */
	function handleKeydown(event: KeyboardEvent) {
		if (open && event.key === "Escape") {
			open = false;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />
{#if content !== undefined && content !== null && content !== false}
	<Tooltip.Provider delayDuration={10}>
		<Tooltip.Root bind:open>
			<Tooltip.Trigger bind:ref={trigger}>
				{#snippet child({
					props,
				}: {
					props: Record<string, unknown>;
				})}{@render children({
						props,
					})}{/snippet}
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
						"settings-tooltip-positioner settings-tooltip max-w-[min(280px,calc(100vw-24px))] rounded-[6px] border border-solid border-tooltip-border bg-tooltip px-[12px] py-[9px] text-[12px] leading-[1.5] [overflow-wrap:anywhere] text-tooltip-text shadow-[0_4px_16px_#0003] [&_hr]:mx-0 [&_hr]:my-[6px] [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-solid [&_hr]:border-tooltip-divider",
						aboveMenu ? "z-[60]" : "z-30",
					)}
				>
					{#snippet child({ wrapperProps, props, open: visible })}<div
							{...wrapperProps}
						>
							{#if visible}<div
									{...props}
									transition:tooltipTransition
								>
									{#if typeof limited === "string"}<span
											class="whitespace-pre-wrap"
											>{limited}</span
										>{:else if limited}{@render limited()}{/if}
								</div>{/if}
						</div>{/snippet}
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip.Root>
	</Tooltip.Provider>
{:else}{@render children({ props: {} })}{/if}
