<script lang="ts">
	// マスクで内側を抜き、親要素の外周に沿って動く光を表示する。
	import { cn } from "cnfast";
	import { animate, type AnimationOptions } from "motion";
	import { MediaQuery } from "svelte/reactivity";
	import { isNonZeroNumber } from "@nerita/shared/valuePredicates";
	/** CSS プロパティとカスタムプロパティを、既定の外観に上書きする。 */
	type BeamStyle = string | Record<string, string | number | undefined>;
	/** 境界線の色・速度・大きさと Motion JS の再生条件を指定する。 */
	type Props = {
		size?: number;
		duration?: number;
		delay?: number;
		colorFrom?: string;
		colorTo?: string;
		transition?: AnimationOptions;
		className?: string;
		style?: BeamStyle;
		reverse?: boolean;
		initialOffset?: number;
		borderThickness?: number;
		opacity?: number;
		glowIntensity?: number;
		beamBorderRadius?: number;
		pauseOnHover?: boolean;
		speedMultiplier?: number;
	};
	let {
		size = 50,
		duration = 6,
		delay = 0,
		colorFrom = "#7400ff",
		colorTo = "#9b41ff",
		transition,
		className,
		style,
		reverse = false,
		initialOffset = 0,
		borderThickness = 1,
		opacity = 1,
		glowIntensity = 0,
		beamBorderRadius,
		pauseOnHover = false,
		speedMultiplier = 1,
	}: Props = $props();
	const reducedMotion = new MediaQuery("(prefers-reduced-motion: reduce)");
	const appearance = $derived(
		[
			`width:${size}px`,
			`offset-path:rect(0 auto auto 0 round ${beamBorderRadius ?? size}px)`,
			`--color-from:${colorFrom}`,
			`--color-to:${colorTo}`,
			`opacity:${opacity}`,
			glowIntensity > 0
				? `box-shadow:0 0 ${glowIntensity * 5}px ${glowIntensity * 2}px var(--color-from)`
				: "",
			isNonZeroNumber(beamBorderRadius)
				? `border-radius:${beamBorderRadius}px`
				: "",
			styleText(style),
		]
			.filter(Boolean)
			.join(";"),
	);

	/** 数値の長さを px に変換し、単位のない CSS 値とカスタムプロパティは維持する。 */
	function styleText(overrides: BeamStyle | undefined) {
		if (typeof overrides === "string") {
			return overrides;
		}
		if (!overrides) {
			return "";
		}
		const unitless = new Set([
			"opacity",
			"zIndex",
			"order",
			"flex",
			"flexGrow",
			"flexShrink",
			"fontWeight",
			"lineHeight",
			"zoom",
			"scale",
		]);
		return Object.entries(overrides)
			.filter(([, value]) => value !== undefined)
			.map(([key, value]) => {
				const property = key.startsWith("--")
					? key
					: key.replace(
							/[A-Z]/g,
							(letter) => `-${letter.toLowerCase()}`,
						);
				const lengthValue =
					typeof value === "number" && !unitless.has(key);
				const cssValue =
					lengthValue && !key.startsWith("--")
						? `${value}px`
						: String(value);
				return `${property}:${cssValue}`;
			})
			.join(";");
	}

	/** 光の外周移動を DOM だけで再生し、取り外し時に停止する。 */
	function attachBeam(node: HTMLDivElement) {
		/** パラメーター変更ごとに再生と親のイベント購読を入れ替える。 */
		function startAnimation() {
			const offsets = reverse
				? [`${100 - initialOffset}%`, `${-initialOffset}%`]
				: [`${initialOffset}%`, `${100 + initialOffset}%`];
			const actualDuration =
				speedMultiplier !== 0 ? duration / speedMultiplier : duration;
			// 一定速度の外周移動はブラウザーに任せ、独自の transition がある場合だけ Motion を使う。
			const controls = transition
				? animate(
						node,
						{ offsetDistance: offsets },
						{
							repeat: Infinity,
							ease: "linear",
							duration: actualDuration,
							delay: -delay,
							...transition,
						},
					)
				: node.animate(
						{ offsetDistance: offsets },
						{
							duration: Math.max(0, actualDuration) * 1000,
							delay: -delay * 1000,
							iterations: Infinity,
							easing: "linear",
							fill: "both",
						},
					);
			const hoverTarget =
				node.closest(".group") ??
				node.parentElement?.parentElement?.parentElement;
			/** 親ボタンのホバーと低減設定では、現在位置を維持して止める。 */
			function syncPlayback() {
				if (reducedMotion.current) {
					controls.pause();
					return;
				}
				const hovered = hoverTarget?.matches(":hover") === true;
				if (pauseOnHover && hovered) {
					controls.pause();
				} else {
					controls.play();
				}
			}
			syncPlayback();
			hoverTarget?.addEventListener("pointerenter", syncPlayback);
			hoverTarget?.addEventListener("pointerleave", syncPlayback);
			return () => {
				controls.cancel();
				hoverTarget?.removeEventListener("pointerenter", syncPlayback);
				hoverTarget?.removeEventListener("pointerleave", syncPlayback);
			};
		}
		// attachment 内で再生の設定に合わせて動かし直し、旧アニメーションと親のホバー監視を解除する。
		$effect(startAnimation);
	}
</script>

<!-- 内側のマスクで光を切らず、外側で横スクロールにつながるはみ出しを切る。 -->
<div
	class="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
>
	<div
		class={cn(
			"absolute inset-0 rounded-[inherit] border border-solid",
			"border-transparent",
			"[mask-image:linear-gradient(#000,#000),linear-gradient(#000,#000)]",
			"[mask-composite:exclude] [mask-clip:padding-box,border-box]",
		)}
		style:border-width={`${borderThickness}px`}
	>
		<div
			class={cn(
				"absolute aspect-square",
				"bg-gradient-to-l from-[var(--color-from)] via-[var(--color-to)]",
				"to-transparent",
				className,
			)}
			style={appearance}
			{@attach attachBeam}
		></div>
	</div>
</div>
