// セッションの使用量を円形で表示し、増分だけを現在位置から補間する。
import { useEffect } from "react";
import {
	animate,
	motion,
	useMotionValue,
	useReducedMotion,
	useTransform,
} from "motion/react";
import type { ContextUsage as Usage } from "../../../shared/composer";
import { SettingsTooltip } from "../SettingsTooltip";

/** 更新中の通知でもゼロに戻さず、表示途中の値から新しい値へ進める。 */
export function ContextUsage({ usage }: { usage: Usage | null }) {
	const progress = useMotionValue(0);
	const offset = useTransform(progress, [0, 100], [100, 0]);
	const reduced = useReducedMotion();
	const percent = usage ? Math.min(100, (usage.used / usage.size) * 100) : 0;
	useEffect(() => {
		if (reduced || percent <= progress.get()) {
			progress.set(percent);
			return;
		}
		const animation = animate(progress, percent, {
			duration: 0.6,
			ease: "easeOut",
		});
		return () => animation.stop();
	}, [percent, progress, reduced]);
	const label = usage
		? `${usage.used / 1000}K/${usage.size / 1000}K (${Number(percent.toFixed(1))}%)`
		: "使用量は未取得です";
	return (
		<SettingsTooltip
			content={
				<>
					<span>context</span>
					<hr />
					<span>{label}</span>
				</>
			}
		>
			<span
				className="context-usage inline-flex flex-[0_0_24px] text-muted data-[warning=true]:text-warning [&_circle]:fill-none [&_circle]:stroke-current [&_circle]:stroke-2"
				role="progressbar"
				aria-label="コンテキスト使用量"
				aria-valuemin={0}
				aria-valuemax={usage?.size ?? 100}
				aria-valuenow={
					usage ? Math.min(usage.used, usage.size) : undefined
				}
				aria-valuetext={`context: ${label}`}
				tabIndex={0}
				data-warning={percent > 50}
			>
				<svg
					viewBox="0 0 24 24"
					width={24}
					height={24}
					aria-hidden="true"
				>
					<circle
						className="context-track opacity-20"
						cx={12}
						cy={12}
						r={8}
					/>
					<motion.circle
						className="context-fill origin-center [transform:rotate(-90deg)] [stroke-linecap:round]"
						cx={12}
						cy={12}
						r={8}
						pathLength={100}
						strokeDasharray="100"
						style={{ strokeDashoffset: offset }}
					/>
				</svg>
			</span>
		</SettingsTooltip>
	);
}
