<!-- 保存ボタンと保存状態を表示し、フッターが消えるまでの待機と操作時の再表示を管理する。 -->
<script lang="ts">
	import { untrack } from "svelte";
	import { fade } from "svelte/transition";
	import { MediaQuery } from "svelte/reactivity";
	import BadgeAlert from "@lucide/svelte/icons/badge-alert";
	import CircleCheck from "@lucide/svelte/icons/circle-check";
	import { cn } from "cnfast";
	import ButtonCurtain from "../ui/ButtonCurtain.svelte";
	import { buttonStyle } from "./managerFields";

	let {
		dirty,
		saved,
		disabled,
		label = "変更を保存",
	}: {
		dirty: boolean;
		saved: boolean;
		disabled: boolean;
		label?: string;
	} = $props();
	const reducedMotion = new MediaQuery("(prefers-reduced-motion: reduce)");
	let footerPhase = $state<"hidden" | "shown" | "leaving">(
		untrack(() => (saved ? "shown" : "hidden")),
	);
	let instantFooter = $state(false);
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
	// Host の保存応答と編集状態に合わせて退場を予約し、再編集・破棄時にタイマーを解除する。
	$effect(() => {
		if (dirty) {
			untrack(showFooter);
			return;
		}
		if (!saved) {
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
	});
</script>

<svelte:window
	onpointerdown={interruptExit}
	onkeydown={interruptExit}
	onwheel={interruptExit}
/>

<footer
	data-phase={footerPhase}
	data-instant={instantFooter}
	aria-hidden={footerPhase === "hidden"}
	inert={footerPhase === "hidden"}
	ontransitionend={finishExit}
	class={cn(
		"save-footer fixed inset-x-0 bottom-0 z-20 border-t border-input-border px-4 py-3 sm:px-6",
		"bg-[var(--nerita-side-bar-background)]",
	)}
>
	<div
		class="mx-auto flex w-full max-w-5xl items-center justify-between gap-3"
	>
		<div role="status" aria-atomic="true" class="min-w-0 text-xs">
			{#if dirty}
				<span class="flex items-center gap-2">
					<BadgeAlert
						size={16}
						class="shrink-0 text-warning"
						aria-hidden="true"
					/>
					未保存の変更があります
				</span>
			{:else if saved}
				<span
					class="flex items-center gap-2"
					in:fade|global={{
						duration: reducedMotion.current ? 0 : 200,
					}}
				>
					<CircleCheck
						size={16}
						class="shrink-0 text-menu-check"
						aria-hidden="true"
					/>
					保存しました
				</span>
			{/if}
		</div>
		<button
			type="submit"
			class={cn(
				buttonStyle,
				"group relative isolate shrink-0 overflow-hidden",
			)}
			{disabled}
		>
			{label}
			{#if !disabled}
				<ButtonCurtain name={label} className="bg-sky-300" />
			{/if}
		</button>
	</div>
</footer>

<style>
	.save-footer {
		visibility: hidden;
		opacity: 0;
		transform: translateY(100%);
		transition:
			transform 300ms ease-in,
			opacity 300ms ease-in;
	}

	.save-footer[data-phase="shown"] {
		visibility: visible;
		opacity: 1;
		transform: translateY(0);
	}

	.save-footer[data-phase="leaving"] {
		visibility: visible;
		transition:
			transform 200ms ease-out,
			opacity 200ms ease-out;
	}

	.save-footer[data-instant="true"] {
		transition: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.save-footer {
			transition: none;
		}
	}
</style>
