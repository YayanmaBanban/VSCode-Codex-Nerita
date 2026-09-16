// Lightswindの境界線演出。Webview用のMotionと型付きスタイルで描画する。
"use client";

import { clsx } from "clsx";
import { motion, type Transition, type MotionStyle } from "motion/react";

/** 境界線の色・速度・大きさを指定する。 */
type BorderBeamProps = {
	/**
	 * The size of the border beam.
	 */
	size?: number;
	/**
	 * The duration of the border beam.
	 */
	duration?: number;
	/**
	 * The delay of the border beam.
	 */
	delay?: number;
	/**
	 * The color of the border beam from.
	 */
	colorFrom?: string;
	/**
	 * The color of the border beam to.
	 */
	colorTo?: string;
	/**
	 * The motion transition of the border beam.
	 */
	transition?: Transition;
	/**
	 * The class name of the border beam.
	 */
	className?: string;
	/**
	 * The style of the border beam.
	 */
	style?: MotionStyle;
	/**
	 * Whether to reverse the animation direction.
	 */
	reverse?: boolean;
	/**
	 * The initial offset position (0-100).
	 */
	initialOffset?: number;
	/**
	 * The thickness of the border.
	 */
	borderThickness?: number;
	/**
	 * The opacity of the beam.
	 */
	opacity?: number;
	/**
	 * The intensity of the glow effect.
	 */
	glowIntensity?: number;
	/**
	 * Border radius of the beam in pixels.
	 */
	beamBorderRadius?: number;
	/**
	 * Whether to pause animation on hover.
	 */
	pauseOnHover?: boolean;
	/**
	 * Animation speed multiplier (higher is faster).
	 */
	speedMultiplier?: number;
};

/** マスクで内側を抜き、光の軌道をボタンの外周に限定する。 */
export const BorderBeam = ({
	className,
	size = 50,
	delay = 0,
	duration = 6,
	colorFrom = "#7400ff",
	colorTo = "#9b41ff",
	transition,
	style,
	reverse = false,
	initialOffset = 0,
	borderThickness = 1,
	opacity = 1,
	glowIntensity = 0,
	beamBorderRadius,
	pauseOnHover = false,
	speedMultiplier = 1,
}: BorderBeamProps) => {
	// 速度倍率から一周の時間を求める。
	const actualDuration = speedMultiplier
		? duration / speedMultiplier
		: duration;

	// 必要な場合だけ発光の影を追加する。
	const glowEffect =
		glowIntensity > 0
			? `0 0 ${glowIntensity * 5}px ${glowIntensity * 2}px var(--color-from)`
			: undefined;
	const beamStyle: MotionStyle & {
		"--color-from": string;
		"--color-to": string;
	} = {
		width: size,
		offsetPath: `rect(0 auto auto 0 round ${beamBorderRadius ?? size}px)`,
		"--color-from": colorFrom,
		"--color-to": colorTo,
		opacity,
		...(glowEffect ? { boxShadow: glowEffect } : {}),
		...(beamBorderRadius ? { borderRadius: `${beamBorderRadius}px` } : {}),
		...style,
	};

	return (
		<div
			className="pointer-events-none absolute inset-0 rounded-[inherit] border border-solid border-transparent [mask-clip:padding-box,border-box] [mask-composite:exclude] [mask-image:linear-gradient(#000,#000),linear-gradient(#000,#000)]"
			style={{ borderWidth: `${borderThickness}px` }}
		>
			<motion.div
				className={clsx(
					"absolute aspect-square",
					"bg-gradient-to-l from-[var(--color-from)] via-[var(--color-to)] to-transparent",
					pauseOnHover && "group-hover:animation-play-state-paused",
					className,
				)}
				style={beamStyle}
				initial={{ offsetDistance: `${initialOffset}%` }}
				animate={{
					offsetDistance: reverse
						? [`${100 - initialOffset}%`, `${-initialOffset}%`]
						: [`${initialOffset}%`, `${100 + initialOffset}%`],
				}}
				transition={{
					repeat: Infinity,
					ease: "linear",
					duration: actualDuration,
					delay: -delay,
					...transition,
				}}
			/>
		</div>
	);
};
