// 入力欄の上で送信結果を短く伝え、残り表示時間と閉じる操作を提供する。
import { useEffect, useRef, type CSSProperties } from "react";
import { X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

/** 背景色と表示時間を用途ごとに指定できる控えめな通知カード。 */
export function NotificationCard({
	children,
	onClose,
	backgroundColor,
	duration = 2000,
}: {
	children: string;
	onClose: () => void;
	backgroundColor?: CSSProperties["backgroundColor"];
	duration?: number;
}) {
	const close = useRef(onClose);
	close.current = onClose;
	const reducedMotion = useReducedMotion();
	useEffect(() => {
		const timer = setTimeout(() => close.current(), duration);
		return () => clearTimeout(timer);
	}, [duration]);
	return (
		<div
			className="notification-card mx-[14px] mt-2 overflow-hidden rounded-md border border-input-border bg-input text-input-text"
			style={{ backgroundColor }}
		>
			<div className="flex items-start gap-2 px-3 py-2">
				<p
					role="status"
					className="m-0 line-clamp-2 min-w-0 flex-1 text-[12px] leading-[1.5] [overflow-wrap:anywhere]"
					title={children}
				>
					{children}
				</p>
				<button
					type="button"
					aria-label="通知を閉じる"
					onClick={onClose}
					className="flex h-5 w-5 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 text-muted hover:text-input-text focus-visible:outline-2 focus-visible:outline-focus"
				>
					<X size={14} aria-hidden="true" />
				</button>
			</div>
			<motion.div
				aria-hidden="true"
				className="notification-progress h-[2px] origin-left bg-current opacity-30"
				initial={{ transform: "scaleX(1)" }}
				animate={{ transform: "scaleX(0)" }}
				transition={{
					duration: duration / 1000,
					ease: reducedMotion
						? (value) => Math.floor(value * 4) / 4
						: "linear",
					type: "tween",
				}}
			/>
		</div>
	);
}
