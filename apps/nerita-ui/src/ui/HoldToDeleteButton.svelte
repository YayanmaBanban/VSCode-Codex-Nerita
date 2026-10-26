<!-- 2秒の長押しで削除を確定し、中断時はカーテンと計時を解除する共通ボタン。 -->
<script lang="ts">
	import { onDestroy } from "svelte";
	import { cn } from "cnfast";
	import Trash from "@lucide/svelte/icons/trash";
	/** 呼び出し側はツールチップのトリガー属性を渡し、`holding` が true の間はツールチップを閉じること。 */
	type Props = {
		label: string;
		disabled?: boolean;
		onDelete: () => void;
		holding?: boolean;
		triggerProps?: Record<string, unknown>;
		tone?: "danger" | "neutral";
		size?: "compact" | "field";
	};
	let {
		label,
		disabled = false,
		onDelete,
		holding = $bindable(false),
		triggerProps = {},
		tone = "danger",
		size = "compact",
	}: Props = $props();
	const descriptionId = $props.id();
	let timer: ReturnType<typeof setTimeout> | undefined;

	/** 押下が続いている間だけ計時し、完了時にも削除可否を確認する。 */
	function startHold() {
		if (disabled || holding) {
			return;
		}
		holding = true;
		timer = setTimeout(completeHold, 2000);
	}
	/** 1回の長押しにつき削除要求を1回だけ送る。 */
	function completeHold() {
		const confirmed = holding && !disabled;
		cancelHold();
		if (confirmed) {
			onDelete();
		}
	}
	/** 未完了の押下と赤い進行表示を破棄する。 */
	function cancelHold() {
		clearTimeout(timer);
		timer = undefined;
		holding = false;
	}
	/** 主ボタンだけを受け付け、領域外での解除も受信する。 */
	function pointerDown(
		event: PointerEvent & { currentTarget: HTMLButtonElement },
	) {
		if (event.button !== 0 || !event.isPrimary || disabled) {
			return;
		}
		event.preventDefault();
		event.currentTarget.focus();
		event.currentTarget.setPointerCapture(event.pointerId);
		startHold();
	}
	/** キャプチャ中でもボタン外へ移動したら削除を取り消す。 */
	function pointerMove(
		event: PointerEvent & { currentTarget: HTMLButtonElement },
	) {
		if (!holding) {
			return;
		}
		const bounds = event.currentTarget.getBoundingClientRect();
		const outsideX =
			event.clientX < bounds.left || event.clientX > bounds.right;
		const outsideY =
			event.clientY < bounds.top || event.clientY > bounds.bottom;
		if (outsideX || outsideY) {
			cancelHold();
		}
	}
	/** キーボードも同じ長押し条件を使い、自動リピートで計時を再開しない。 */
	function keyDown(event: KeyboardEvent) {
		if (event.key !== " " && event.key !== "Enter") {
			return;
		}
		event.preventDefault();
		if (!event.repeat) {
			startHold();
		}
	}
	/** キーを離したときは短い押下を削除へ変換しない。 */
	function keyUp(event: KeyboardEvent) {
		if (event.key === " " || event.key === "Enter") {
			event.preventDefault();
			cancelHold();
		}
	}
	// 呼出し側で無効になったら、進行中の長押しとタイマーを取り消す。
	$effect(() => {
		if (disabled) {
			cancelHold();
		}
	});
	onDestroy(cancelHold);
</script>

<svelte:window onblur={cancelHold} />
<button
	{...triggerProps}
	type="button"
	{disabled}
	aria-label={label}
	aria-describedby={descriptionId}
	data-holding={holding || undefined}
	class={cn(
		"hold-delete relative inline-flex shrink-0 touch-none items-center justify-center overflow-hidden rounded-[5px] border-0 p-0",
		size === "field" ? "size-[38px]" : "size-8",
		"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-40",
		tone === "danger"
			? "bg-red-500/10 text-red-500 enabled:hover:bg-red-500/20"
			: "enabled:hover:bg-hover bg-transparent text-muted",
	)}
	onpointerdown={pointerDown}
	onpointermove={pointerMove}
	onpointerup={cancelHold}
	onpointercancel={cancelHold}
	onlostpointercapture={cancelHold}
	onblur={cancelHold}
	onkeydown={keyDown}
	onkeyup={keyUp}
>
	<span
		class="hold-curtain pointer-events-none absolute inset-0 origin-left bg-red-700"
		aria-hidden="true"
	></span>
	<Trash size={15} class="relative" aria-hidden="true" />
</button>
<span id={descriptionId} class="sr-only">長押しで削除します</span>

<style>
	.hold-curtain {
		transform: scaleX(0);
	}
	.hold-delete[data-holding] {
		animation: shake 120ms linear infinite;
		color: white;
	}
	.hold-delete[data-holding] .hold-curtain {
		animation: curtain 2s linear forwards;
	}
	@keyframes curtain {
		to {
			transform: scaleX(1);
		}
	}
	@keyframes shake {
		0%,
		100% {
			transform: translateX(0);
		}
		25% {
			transform: translateX(-1px) rotate(-2deg);
		}
		75% {
			transform: translateX(1px) rotate(2deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.hold-delete[data-holding] {
			animation: none;
		}
	}
</style>
