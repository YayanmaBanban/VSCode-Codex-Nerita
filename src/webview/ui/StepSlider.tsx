// 等間隔の段階と現在位置までの塗りつぶしを持つ、汎用スライダー。
import { cn } from "cnfast";
import { useEffect, useRef, useState } from "react";
import "./stepSlider.css";

/** 数値の段階を扱い、選択肢の意味や送信先には依存しない。 */
export function StepSlider({
	value,
	count,
	label,
	valueText,
	disabled = false,
	onChange,
	onPreview,
}: {
	value: number;
	count: number;
	label: string;
	valueText: string;
	disabled?: boolean;
	onChange: (value: number) => void;
	onPreview?: (value: number | null) => void;
}) {
	const [draft, setDraft] = useState<number | null>(null);
	const drag = useRef<number | null>(null);
	const max = Math.max(0, count - 1);
	const selected = Math.min(max, Math.max(0, draft ?? value));
	const progress = max > 0 ? selected / max : 0;
	// Host の更新を受け取るまでは、解放した位置を維持する。
	useEffect(() => {
		if (drag.current === null) {
			setDraft(null);
			onPreview?.(null);
		}
	}, [value, count, onPreview]);
	/** マウスとキーボードの確定位置を、Host の反映前にも表示する。 */
	function commit(next: number) {
		setDraft(next);
		onPreview?.(next);
		onChange(next);
	}
	/** ドラッグ中は表示だけを更新し、設定要求で操作が中断されないようにする。 */
	function preview(next: number) {
		drag.current = next;
		setDraft(next);
		onPreview?.(Math.round(next));
	}
	/** 解放時だけ段階を確定し、中断時は Host の現在値へ戻す。 */
	function finish(shouldCommit: boolean) {
		const next = drag.current;
		if (next === null) {
			return;
		}
		drag.current = null;
		if (shouldCommit && !disabled) {
			commit(Math.round(next));
		} else {
			setDraft(null);
			onPreview?.(null);
		}
	}
	return (
		<div
			className={cn(
				"step-slider relative rounded-full bg-settings-hover",
				disabled && "opacity-50",
			)}
		>
			{/* 途中ではつまみの中心まで塗り、最大値ではレール全体を塗る。 */}
			<div
				aria-hidden="true"
				className={cn(
					"pointer-events-none absolute inset-y-0 left-0 rounded-l-full bg-[#58bafa]",
					progress === 1 && "rounded-r-full",
				)}
				style={{
					width: fillWidth(progress),
				}}
			/>
			<input
				type="range"
				min={0}
				max={max}
				step={drag.current === null ? 1 : "any"}
				value={selected}
				aria-label={label}
				aria-valuetext={valueText}
				disabled={disabled || count < 2}
				className={cn(
					"step-slider-input relative m-0 block h-[32px] w-full touch-none cursor-pointer appearance-none rounded-full bg-transparent p-0 accent-foreground",
					"focus-visible:outline-1 focus-visible:outline-settings-focus focus-visible:outline-offset-[-1px] disabled:cursor-default",
					"[&::-webkit-slider-thumb]:size-[36px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-transparent",
				)}
				onPointerDown={(event) => {
					if (event.button !== 0 || disabled || count < 2) {
						return;
					}
					event.currentTarget.setPointerCapture(event.pointerId);
					preview(selected);
				}}
				onPointerUp={() => finish(true)}
				onPointerCancel={() => finish(false)}
				onLostPointerCapture={() => finish(false)}
				onChange={(event) => {
					const next = Number(event.target.value);
					if (drag.current !== null) {
						preview(next);
					} else {
						commit(next);
					}
				}}
			/>
			<div
				aria-hidden="true"
				className="step-slider-thumb pointer-events-none absolute top-1/2 size-[36px] -translate-x-1/2 -translate-y-1/2"
				style={{
					left: `calc(${progress * 100}% + ${18 - progress * 36}px)`,
				}}
			>
				<span className="block size-full rounded-full bg-foreground" />
			</div>
			<div className="pointer-events-none absolute inset-x-[18px] inset-y-0">
				{Array.from({ length: count }, (_, index) => (
					<button
						key={index}
						type="button"
						tabIndex={-1}
						aria-label={`${label}: ${index + 1}`}
						disabled={disabled || count < 2}
						className={cn(
							"step-slider-point absolute top-1/2 flex size-[28px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-0 bg-transparent p-0",
							index === selected
								? "pointer-events-none invisible"
								: "pointer-events-auto",
						)}
						style={{
							left: `${max > 0 ? (index / max) * 100 : 0}%`,
						}}
						onClick={() => commit(index)}
					>
						<span
							aria-hidden="true"
							className="block size-[4px] rounded-full bg-muted opacity-60"
						/>
					</button>
				))}
			</div>
		</div>
	);
}

/** つまみの可動幅とレール幅の差を補正する。 */
function fillWidth(progress: number) {
	if (progress === 0) {
		return "0%";
	}
	if (progress === 1) {
		return "100%";
	}
	return `calc(${progress * 100}% + ${18 - progress * 36}px)`;
}
