<!-- 連続したドラッグ表示と、解放時だけの段階確定を分ける汎用スライダー。 -->
<script lang="ts">
	import { untrack } from "svelte";
	import { cn } from "cnfast";
	import "./stepSlider.css";
	/** プレビューは表示だけに使い、`onChange` で設定を確定する。 */
	type Props = {
		value: number;
		count: number;
		label: string;
		valueText: string;
		disabled?: boolean;
		onChange: (value: number) => void;
		onPreview?: (value: number | null) => void;
	};
	let {
		value,
		count,
		label,
		valueText,
		disabled = false,
		onChange,
		onPreview,
	}: Props = $props();
	let drag = $state<number | null>(null);
	const max = $derived(Math.max(0, count - 1));
	let selected = $derived(Math.min(max, Math.max(0, drag ?? value)));
	const progress = $derived(max > 0 ? selected / max : 0);
	let lastReceived: { value: number; count: number } | undefined;

	/** 外部の値が変わったときだけ、親に残るプレビュー表示を解除する。 */
	function synchronizeExternalValue() {
		const received = { value, count };
		const unchanged =
			lastReceived?.value === received.value &&
			lastReceived.count === received.count;
		if (unchanged) {
			return;
		}
		lastReceived = received;
		// Host 側の確定値が届いたら、進行中のドラッグ以外の楽観表示を解除する。
		untrack(() => {
			if (drag !== null) {
				return;
			}
			onPreview?.(null);
		});
	}
	// Host の確定値が届いた時に親のプレビューを解除するため、ドラッグのイベントだけでは足りない。
	$effect(synchronizeExternalValue);

	/** 外部の確定値が届くまでは、解放した位置を表示する。 */
	function commit(next: number) {
		selected = Math.min(max, Math.max(0, next));
		onPreview?.(next);
		onChange(next);
	}

	/** ドラッグでは連続表示だけを更新し、設定要求を送らない。 */
	function preview(next: number) {
		drag = next;
		onPreview?.(Math.round(next));
	}

	/** 解放時は一度だけ確定し、中断時は外部の現在値へ戻す。 */
	function finish(shouldCommit: boolean) {
		const next = drag;
		if (next === null) {
			return;
		}
		drag = null;
		if (shouldCommit && !disabled) {
			commit(Math.round(next));
		} else {
			onPreview?.(null);
		}
	}

	/** つまみの可動幅とレール幅の差を補正する。 */
	function fillWidth(position: number) {
		if (position === 0) {
			return "0%";
		}
		if (position === 1) {
			return "100%";
		}
		return `calc(${position * 100}% + ${18 - position * 36}px)`;
	}

	/** ドラッグ開始後は、レールの外で解放されても確定・中断を受け取る。 */
	function startDrag(
		event: PointerEvent & { currentTarget: HTMLInputElement },
	) {
		if (event.button !== 0 || disabled || count < 2) {
			return;
		}
		event.currentTarget.setPointerCapture(event.pointerId);
		preview(selected);
	}

	/** キーボード操作は即確定し、ポインター操作中はプレビューする。 */
	function changeInput(event: Event & { currentTarget: HTMLInputElement }) {
		const next = Number(event.currentTarget.value);
		if (drag !== null) {
			preview(next);
		} else {
			commit(next);
		}
	}
</script>

<div
	class={cn(
		"step-slider relative rounded-full bg-settings-hover",
		disabled && "opacity-50",
	)}
>
	<div
		aria-hidden="true"
		class={cn(
			"pointer-events-none absolute inset-y-0 left-0 rounded-l-full bg-[#58bafa]",
			progress === 1 && "rounded-r-full",
		)}
		style:width={fillWidth(progress)}
	></div>
	<input
		type="range"
		min={0}
		{max}
		step={drag === null ? 1 : "any"}
		value={selected}
		aria-label={label}
		aria-valuetext={valueText}
		disabled={disabled || count < 2}
		class={cn(
			"step-slider-input relative m-0 block h-[32px] w-full cursor-pointer",
			"touch-none appearance-none rounded-full bg-transparent p-0",
			"accent-foreground",
			"focus-visible:outline-1 focus-visible:outline-offset-[-1px]",
			"focus-visible:outline-settings-focus",
			"disabled:cursor-default",
			"[&::-webkit-slider-thumb]:size-[36px]",
			"[&::-webkit-slider-thumb]:appearance-none",
			"[&::-webkit-slider-thumb]:rounded-full",
			"[&::-webkit-slider-thumb]:bg-transparent",
		)}
		onpointerdown={startDrag}
		onpointerup={() => finish(true)}
		onpointercancel={() => finish(false)}
		onlostpointercapture={() => finish(false)}
		oninput={changeInput}
	/>
	<div
		aria-hidden="true"
		class={cn(
			"step-slider-thumb pointer-events-none absolute top-1/2 size-[36px]",
			"-translate-x-1/2 -translate-y-1/2",
		)}
		style:left={`calc(${progress * 100}% + ${18 - progress * 36}px)`}
	>
		<span class="block size-full rounded-full bg-foreground"></span>
	</div>
	<div class="pointer-events-none absolute inset-x-[18px] inset-y-0">
		{#each Array.from({ length: count }, (_, index) => index) as index (index)}
			<button
				type="button"
				tabindex={-1}
				aria-label={`${label}: ${index + 1}`}
				disabled={disabled || count < 2}
				class={cn(
					"step-slider-point absolute top-1/2 flex size-[28px] -translate-x-1/2",
					"-translate-y-1/2 items-center justify-center rounded-full border-0",
					"bg-transparent p-0",
					index === selected
						? "pointer-events-none invisible"
						: "pointer-events-auto",
				)}
				style:left={`${max > 0 ? (index / max) * 100 : 0}%`}
				onclick={() => commit(index)}
			>
				<span
					aria-hidden="true"
					class="block size-[4px] rounded-full bg-muted opacity-60"
				></span>
			</button>
		{/each}
	</div>
</div>
