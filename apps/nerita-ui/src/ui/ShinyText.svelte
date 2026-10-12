<script lang="ts">
	// 文字の光沢を WAAPI で動かし、方向・往復・待機・一時停止を制御する。
	import { cn } from "cnfast";
	import { MediaQuery } from "svelte/reactivity";
	/** 表示文言と光沢の色・再生条件を指定する。 */
	type Props = {
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
	let {
		text,
		disabled = false,
		speed = 2,
		className = "",
		color = "#b5b5b5",
		shineColor = "#ffffff",
		spread = 120,
		yoyo = false,
		pauseOnHover = false,
		direction = "left",
		delay = 0,
	}: Props = $props();
	const reducedMotion = new MediaQuery("(prefers-reduced-motion: reduce)");

	/** 往路・復路と各終端の待機を、ブラウザーが補間するキーフレームに変換する。 */
	function shineKeyframes(duration: number, waiting: number): Keyframe[] {
		const cycle = duration + waiting;
		const start = direction === "left" ? "150% center" : "-50% center";
		const end = direction === "left" ? "-50% center" : "150% center";
		if (!yoyo) {
			const movementEnd = cycle > 0 ? duration / cycle : 1;
			return [
				{ backgroundPosition: start, offset: 0 },
				{ backgroundPosition: end, offset: movementEnd },
				{ backgroundPosition: end, offset: 1 },
			];
		}
		const total = cycle * 2;
		const outboundEnd = total > 0 ? duration / total : 0.5;
		const returnEnd = total > 0 ? (cycle + duration) / total : 1;
		return [
			{ backgroundPosition: start, offset: 0 },
			{ backgroundPosition: end, offset: outboundEnd },
			{ backgroundPosition: end, offset: 0.5 },
			{ backgroundPosition: start, offset: returnEnd },
			{ backgroundPosition: start, offset: 1 },
		];
	}

	/** フレームごとの状態更新を避け、パラメーターと DOM の再生状態だけを同期する。 */
	function attachShine(node: HTMLSpanElement) {
		let animation: Animation | undefined;
		let previousDirection: Props["direction"];
		let hovering = false;

		/** 無効・ホバー中は現在位置で止め、再開時も同じ位置から続ける。 */
		function syncPlayback() {
			if (!animation) {
				return;
			}
			if (disabled || reducedMotion.current) {
				animation.pause();
				return;
			}
			if (pauseOnHover && hovering) {
				animation.pause();
			} else {
				animation.play();
			}
		}

		/** パラメーター変更は経過時間を保持し、方向変更だけ先頭へ戻す。 */
		function updateAnimation() {
			const duration = Math.max(0, speed) * 1000;
			const waiting = Math.max(0, delay) * 1000;
			const totalDuration = (duration + waiting) * (yoyo ? 2 : 1);
			const frames = shineKeyframes(duration, waiting);
			if (animation?.effect instanceof KeyframeEffect) {
				animation.effect.setKeyframes(frames);
				animation.effect.updateTiming({ duration: totalDuration });
			} else {
				animation?.cancel();
				animation = node.animate(frames, {
					duration: totalDuration,
					iterations: Infinity,
					easing: "linear",
				});
			}
			if (previousDirection !== direction) {
				animation.currentTime = 0;
			}
			previousDirection = direction;
			syncPlayback();
		}
		// attachment 内で設定の変化を実 DOM のアニメーションへ渡し、旧再生を停止する。
		$effect(updateAnimation);

		/** ホバー状態はイベントだけで更新し、毎フレーム描画には持ち込まない。 */
		function enter() {
			hovering = true;
			syncPlayback();
		}
		function leave() {
			hovering = false;
			syncPlayback();
		}
		node.addEventListener("pointerenter", enter);
		node.addEventListener("pointerleave", leave);
		return () => {
			animation?.cancel();
			node.removeEventListener("pointerenter", enter);
			node.removeEventListener("pointerleave", leave);
		};
	}
</script>

<span
	class={cn("inline-block", className)}
	style:background-image={`linear-gradient(${spread}deg, ${color} 0%, ${color} 35%, ${shineColor} 50%, ${color} 65%, ${color} 100%)`}
	style:background-size="200% auto"
	style:background-position="150% center"
	style:-webkit-background-clip="text"
	style:background-clip="text"
	style:-webkit-text-fill-color="transparent"
	{@attach attachShine}>{text}</span
>
