<!-- 数値の直接入力・上下キー・左右ドラッグに対応し、範囲内での値の位置を背景色で示す。入力エラーも表示する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import FieldErrorTooltip from "./FieldErrorTooltip.svelte";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";

	let {
		label,
		value,
		min,
		max,
		step = 1,
		unit,
		description,
		disabled = false,
		required = true,
		onChange,
	}: {
		label: string;
		value: number | undefined;
		min: number;
		max: number;
		step?: number;
		unit?: string;
		description?: string;
		disabled?: boolean;
		required?: boolean;
		onChange: (value: number | undefined) => void;
	} = $props();
	const id = $props.id();
	const helpId = `${id}-help`;
	let accessibleLabel = $derived(
		isNonEmptyString(unit) ? `${label}（${unit}）` : label,
	);
	let descriptionId = $derived(
		isNonEmptyString(description) ? helpId : undefined,
	);
	/** 入力説明とエラーの両方を読み上げ対象にし、正常時は不要な属性を残さない。 */
	function describedBy(errorId: string | undefined) {
		const ids = [descriptionId, errorId].filter(isNonEmptyString).join(" ");
		return isNonEmptyString(ids) ? ids : undefined;
	}
	let dragging = $state(false);
	let drag: { pointerId: number; x: number; value: number } | undefined;
	let error = $derived(validationError());
	let fill = $derived(
		value === undefined || !Number.isFinite(value)
			? 0
			: Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)),
	);

	/** 手入力は補正せず、不正な値を修正できるよう理由を表示する。 */
	function validationError() {
		if (value === undefined || !Number.isFinite(value)) {
			return required
				? `${label}が空欄です。数値を入力してください。`
				: undefined;
		}
		if (value < min || value > max) {
			return `${label}は${min}〜${max}${unit ?? ""}の範囲で入力してください。`;
		}
		const steps = (value - min) / step;
		if (Math.abs(steps - Math.round(steps)) > 1e-7) {
			return step === 1
				? `${label}は整数で入力してください。`
				: `${label}は${step}${unit ?? ""}刻みで入力してください。`;
		}
		return undefined;
	}
	/** ネイティブ入力で空欄や入力途中になった数値は未入力として親へ渡す。 */
	function input(event: Event & { currentTarget: HTMLInputElement }) {
		const next = event.currentTarget.valueAsNumber;
		onChange(Number.isFinite(next) ? next : undefined);
	}
	/** キー操作とドラッグでは指定した刻みに値を合わせ、範囲を越えないようにする。 */
	function increment(base: number, count: number) {
		const origin = Number.isFinite(base) ? base : min;
		const position = Math.round((origin - min) / step) + count;
		const next = Number((min + position * step).toPrecision(12));
		const bounded = Math.max(min, Math.min(max, next));
		onChange(bounded);
		return bounded;
	}
	/** 上下キーでは指定した刻みで値を増減し、ブラウザー標準の操作との重複を防ぐ。 */
	function keydown(event: KeyboardEvent) {
		if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
			return;
		}
		event.preventDefault();
		increment(value ?? min, event.key === "ArrowUp" ? 1 : -1);
	}
	/** マウス操作を捕捉し、クリック入力と閾値を越えたドラッグを区別する。 */
	function pointerdown(
		event: PointerEvent & { currentTarget: HTMLInputElement },
	) {
		if (event.button !== 0 || event.pointerType !== "mouse") {
			return;
		}
		if (event.currentTarget.matches(":disabled")) {
			return;
		}
		event.preventDefault();
		event.currentTarget.focus({ preventScroll: true });
		event.currentTarget.setPointerCapture(event.pointerId);
		drag = {
			pointerId: event.pointerId,
			x: event.clientX,
			value: value ?? min,
		};
	}
	/** 横移動 2px ごとに指定した刻みで値を増減する。Shift キーを押している間は増減幅を10倍にする。 */
	function pointermove(
		event: PointerEvent & { currentTarget: HTMLInputElement },
	) {
		if (drag?.pointerId !== event.pointerId) {
			return;
		}
		if (event.currentTarget.matches(":disabled")) {
			finishDrag(event.currentTarget);
			return;
		}
		const movement = event.clientX - drag.x;
		if (!dragging && Math.abs(movement) < 4) {
			return;
		}
		dragging = true;
		event.preventDefault();
		const steps = Math.trunc(movement / 2);
		drag.x += steps * 2;
		drag.value = increment(drag.value, steps * (event.shiftKey ? 10 : 1));
	}
	/** ドラッグしなかったクリックでは全選択し、すぐに直接入力できるようにする。 */
	function pointerup(
		event: PointerEvent & { currentTarget: HTMLInputElement },
	) {
		if (drag?.pointerId !== event.pointerId) {
			return;
		}
		if (!dragging) {
			event.currentTarget.select();
		}
		finishDrag(event.currentTarget);
	}
	/** 領域外でのドラッグ終了・キャンセルや要素の削除時にも、ポインターの捕捉を解除する。 */
	function finishDrag(node: HTMLInputElement) {
		const pointerId = drag?.pointerId;
		drag = undefined;
		dragging = false;
		if (pointerId !== undefined && node.hasPointerCapture(pointerId)) {
			node.releasePointerCapture(pointerId);
		}
	}
	/** 入力要素が削除されたときに、進行中のドラッグを終了する。 */
	function attach(node: HTMLInputElement) {
		return () => finishDrag(node);
	}
</script>

<FieldErrorTooltip message={error}>
	{#snippet children({
		props,
	}: {
		props: {
			"aria-invalid"?: true;
			"aria-errormessage"?: string;
			"aria-describedby"?: string;
		};
	})}
		<div class="grid min-w-0 gap-2 text-sm">
			<label for={id} class="font-medium">{label}</label>
			<div class="flex min-w-0 items-center gap-2">
				<div
					class={cn(
						"relative min-w-0 flex-1 overflow-hidden rounded-md border border-input-border bg-input",
						"focus-within:ring-2 focus-within:ring-focus",
						disabled && "opacity-50",
					)}
				>
					<div
						aria-hidden="true"
						class="pointer-events-none absolute inset-y-0 left-0 bg-foreground/10"
						style:width={`${fill}%`}
					></div>
					<input
						{@attach attach}
						{id}
						type="number"
						{min}
						{max}
						{step}
						{disabled}
						{required}
						value={value ?? ""}
						aria-label={accessibleLabel}
						{...props}
						aria-describedby={describedBy(
							props["aria-describedby"],
						)}
						oninput={input}
						onkeydown={keydown}
						onpointerdown={pointerdown}
						onpointermove={pointermove}
						onpointerup={pointerup}
						onpointercancel={(event) =>
							finishDrag(event.currentTarget)}
						onlostpointercapture={(event) =>
							finishDrag(event.currentTarget)}
						class={cn(
							"relative w-full min-w-0 cursor-ew-resize [appearance:textfield] appearance-none rounded-md border-0 bg-transparent px-3 py-2 text-sm text-foreground outline-none",
							"disabled:cursor-not-allowed [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
							dragging && "select-none",
						)}
					/>
				</div>
				{#if unit}
					<span aria-hidden="true" class="shrink-0">{unit}</span>
				{/if}
			</div>
		</div>
	{/snippet}
</FieldErrorTooltip>
{#if description}
	<p id={helpId} class="m-0 mt-2 text-xs text-muted">
		{description}
	</p>
{/if}
