// 文字に光沢を流し、速度・方向・一時停止を制御する。
import React, { useState, useCallback, useEffect, useRef } from "react";
import {
	motion,
	useMotionValue,
	useAnimationFrame,
	useTransform,
	type MotionValue,
} from "motion/react";

/** 表示文言と光沢の色・再生条件を指定する。 */
type ShinyTextProps = {
	text: string;
	disabled?: boolean;
	speed?: number;
	className?: string;
	color?: string;
	shineColor?: string;
	spread?: number;
	yoyo?: boolean;
	pauseOnHover?: boolean;
	direction?: "left" | "right";
	delay?: number;
};

/** Motion の値で文字のグラデーションを動かす。 */
export const ShinyText: React.FC<ShinyTextProps> = (props) => {
	const {
		text,
		disabled = false,
		speed = 2,
		className = "",
		yoyo = false,
		pauseOnHover = false,
		direction = "left",
		delay = 0,
	} = props;
	const [isPaused, setIsPaused] = useState(false);
	const progress = useMotionValue(0);
	const elapsedRef = useRef(0);
	const lastTimeRef = useRef<number | null>(null);
	const directionRef = useRef(direction === "left" ? 1 : -1);

	const animationDuration = speed * 1000;
	const delayDuration = delay * 1000;

	useAnimationFrame((time) => {
		if (disabled || isPaused) {
			lastTimeRef.current = null;
			return;
		}

		if (lastTimeRef.current === null) {
			lastTimeRef.current = time;
			return;
		}

		const deltaTime = time - lastTimeRef.current;
		lastTimeRef.current = time;

		elapsedRef.current += deltaTime;

		// 光沢の進行度を0から100で管理する。
		if (yoyo) {
			updateYoyoProgress(
				animationDuration,
				delayDuration,
				elapsedRef,
				progress,
				directionRef,
			);
		} else {
			const cycleDuration = animationDuration + delayDuration;
			const cycleTime = elapsedRef.current % cycleDuration;

			if (cycleTime < animationDuration) {
				// 光沢を一方向へ進める。
				const p = (cycleTime / animationDuration) * 100;
				progress.set(directionRef.current === 1 ? p : 100 - p);
			} else {
				// 光沢が文字の表示範囲から抜けた位置で待機する。
				progress.set(directionRef.current === 1 ? 100 : 0);
			}
		}
	});

	useEffect(() => {
		directionRef.current = direction === "left" ? 1 : -1;
		elapsedRef.current = 0;
		progress.set(0);
	}, [direction, progress]);

	// 進行度を、文字の右外側から左外側へ抜ける背景位置に変換する。
	const backgroundPosition = useTransform(
		progress,
		[0, 100],
		["150% center", "-50% center"],
	);

	const handleMouseEnter = useCallback(() => {
		if (pauseOnHover) {
			setIsPaused(true);
		}
	}, [pauseOnHover]);

	const handleMouseLeave = useCallback(() => {
		if (pauseOnHover) {
			setIsPaused(false);
		}
	}, [pauseOnHover]);

	const gradientStyle = shineAppearance(props);

	return (
		<motion.span
			className={`inline-block ${className}`}
			style={{ ...gradientStyle, backgroundPosition }}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
		>
			{text}
		</motion.span>
	);
};

/** 往復と両端の待機を含む光沢の進行度を更新する。 */
function updateYoyoProgress(
	animationDuration: number,
	delayDuration: number,
	elapsedRef: React.RefObject<number>,
	progress: MotionValue<number>,
	directionRef: React.RefObject<number>,
) {
	const cycleDuration = animationDuration + delayDuration;
	const fullCycle = cycleDuration * 2;
	const cycleTime = elapsedRef.current % fullCycle;

	if (cycleTime < animationDuration) {
		// 往路は0から100へ進める。
		const p = (cycleTime / animationDuration) * 100;
		progress.set(directionRef.current === 1 ? p : 100 - p);
	} else if (cycleTime < cycleDuration) {
		// 終点で待機する。
		progress.set(directionRef.current === 1 ? 100 : 0);
	} else if (cycleTime < cycleDuration + animationDuration) {
		// 復路は100から0へ戻す。
		const reverseTime = cycleTime - cycleDuration;
		const p = 100 - (reverseTime / animationDuration) * 100;
		progress.set(directionRef.current === 1 ? p : 100 - p);
	} else {
		// 始点で待機する。
		progress.set(directionRef.current === 1 ? 0 : 100);
	}
}

/** 光沢の色と広がりをグラデーションへ変換する。 */
function shineAppearance({
	color = "#b5b5b5",
	shineColor = "#ffffff",
	spread = 120,
}: ShinyTextProps) {
	const gradientStyle = {
		backgroundImage: `linear-gradient(${spread}deg, ${color} 0%, ${color} 35%, ${shineColor} 50%, ${color} 65%, ${color} 100%)`,
		backgroundSize: "200% auto",
		WebkitBackgroundClip: "text",
		backgroundClip: "text",
		WebkitTextFillColor: "transparent",
	} satisfies React.CSSProperties;

	return gradientStyle;
}
