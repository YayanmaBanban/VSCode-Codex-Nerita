<!-- 設定画面の固定フッターの配置・高さ確保と、成功通知後の退場を共有する。 -->
<script lang="ts">
	import { untrack, type Snippet } from "svelte";
	import { MediaQuery } from "svelte/reactivity";
	import { cn } from "cnfast";

	let {
		active,
		saved,
		noticeKey,
		label,
		children,
	}: {
		active: boolean;
		saved: boolean;
		noticeKey?: unknown;
		label?: string | undefined;
		children: Snippet;
	} = $props();
	const reducedMotion = new MediaQuery("(prefers-reduced-motion: reduce)");
	let footerPhase = $state<"hidden" | "shown" | "leaving">(
		untrack(() => (saved ? "shown" : "hidden")),
	);
	let instantFooter = $state(false);
	/** 表示中の実寸を管理画面へ渡し、一覧が固定フッターの下に隠れるのを防ぐ。 */
	function reserveHeight(node: HTMLElement) {
		const container = node.closest("main");
		const visible = footerPhase !== "hidden";
		/** 折り返しや画面幅の変化にも合わせて予約する高さを更新する。 */
		const update = () => {
			const height = visible ? node.getBoundingClientRect().height : 0;
			container?.style.setProperty(
				"--settings-footer-height",
				`${height}px`,
			);
		};
		const observer = new ResizeObserver(update);
		observer.observe(node);
		update();
		return () => {
			observer.disconnect();
			container?.style.removeProperty("--settings-footer-height");
		};
	}
	/** 退場中の再操作では入場を再生せず、直ちに表示状態へ戻す。 */
	function showFooter() {
		instantFooter = footerPhase === "leaving";
		footerPhase = "shown";
	}
	/** 退場中の画面操作だけを割り込みとして扱い、保存後の自動退場を取り消す。 */
	function interruptExit() {
		if (footerPhase === "leaving") {
			showFooter();
		}
	}
	/** 子要素の遷移は無視し、フッター本体が消える遷移の完了時に操作対象から外す。 */
	function finishExit(event: TransitionEvent) {
		const footerTransition =
			event.target === event.currentTarget &&
			event.propertyName === "opacity";
		if (footerTransition && footerPhase === "leaving") {
			footerPhase = "hidden";
		}
	}
	/** Host の通知を起点に表示を更新し、再編集時は退場タイマーを解除する。 */
	function syncVisibility() {
		if (active) {
			untrack(showFooter);
			return;
		}
		void noticeKey;
		if (!saved) {
			footerPhase = "hidden";
			return;
		}
		untrack(() => {
			if (footerPhase === "hidden") {
				instantFooter = true;
				footerPhase = "shown";
			}
		});
		const timeout = setTimeout(() => {
			instantFooter = false;
			footerPhase = reducedMotion.current ? "hidden" : "leaving";
		}, 2000);
		return () => clearTimeout(timeout);
	}
	// Host の応答によるプロパティの更新にも反応し、退場タイマーを解除・再設定するため `$effect` を使う。
	$effect(syncVisibility);
</script>

<svelte:window
	onpointerdown={interruptExit}
	onkeydown={interruptExit}
	onwheel={interruptExit}
/>
<footer
	role={label !== undefined ? "region" : undefined}
	aria-label={label}
	{@attach reserveHeight}
	data-phase={footerPhase}
	data-instant={instantFooter}
	aria-hidden={footerPhase === "hidden"}
	inert={footerPhase === "hidden"}
	ontransitionend={finishExit}
	class={cn(
		"settings-footer fixed inset-x-0 bottom-0 z-20 box-border border-t border-input-border px-4 py-3 sm:px-6",
		"bg-[var(--nerita-side-bar-background)] text-primary-text",
	)}
>
	<div
		class="mx-auto flex w-full max-w-[var(--settings-footer-max-width,64rem)] flex-wrap items-center justify-between gap-3"
	>
		{@render children()}
	</div>
</footer>

<style>
	.settings-footer {
		visibility: hidden;
		opacity: 0;
		transform: translateY(100%);
		transition:
			transform 300ms ease-in,
			opacity 300ms ease-in;
	}

	.settings-footer[data-phase="shown"] {
		visibility: visible;
		opacity: 1;
		transform: translateY(0);
	}

	.settings-footer[data-phase="leaving"] {
		visibility: visible;
		transition:
			transform 200ms ease-out,
			opacity 200ms ease-out;
	}

	.settings-footer[data-instant="true"] {
		transition: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.settings-footer {
			transition: none;
		}
	}
</style>
