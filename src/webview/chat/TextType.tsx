// React Bits TextType の逐次表示を、追記されるチャットとコード表示に合わせて構成する。
// 参照: https://reactbits.dev/text-animations/text-type （MIT）
import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { gsap } from "gsap";
import { MessageText } from "./MessageText";

/** 一度だけ表示する本文と、入力速度・末尾カーソルの設定。 */
type TextTypeProps = {
	text: string;
	streaming: boolean;
	typingSpeed?: number;
	pauseDuration?: number;
	cursorBlinkDuration?: number;
};

/** 追記で巻き戻さず、読み上げにはアニメーション前の全文を渡す。 */
export function TextType({
	text,
	streaming,
	typingSpeed = 20,
	pauseDuration = 4200,
	cursorBlinkDuration = 0.7,
}: TextTypeProps) {
	const reducedMotion = useReducedMotion();
	const [displayed, setDisplayed] = useState("");
	const [showCursor, setShowCursor] = useState(true);
	const cursor = useRef<HTMLSpanElement>(null);
	const segments = useMemo(
		() =>
			Array.from(
				new Intl.Segmenter(undefined, {
					granularity: "grapheme",
				}).segment(text),
				({ segment }) => segment,
			),
		[text],
	);
	const visible = reducedMotion
		? text
		: text.startsWith(displayed)
			? displayed
			: "";
	useEffect(() => {
		if (reducedMotion || visible === text) {
			return;
		}
		const timer = setTimeout(() => {
			const length = Array.from(
				new Intl.Segmenter(undefined, {
					granularity: "grapheme",
				}).segment(visible),
			).length;
			setDisplayed(visible + (segments[length] ?? ""));
		}, typingSpeed);
		return () => clearTimeout(timer);
	}, [text, visible, segments, typingSpeed, reducedMotion]);
	useEffect(() => {
		setShowCursor(true);
		if (streaming || visible !== text) {
			return;
		}
		// 回答を消去・ループせず、指定の休止時間後にカーソルだけを隠す。
		const timer = setTimeout(() => setShowCursor(false), pauseDuration);
		return () => clearTimeout(timer);
	}, [streaming, visible, text, pauseDuration]);
	useEffect(() => {
		if (!cursor.current || reducedMotion || !showCursor) {
			return;
		}
		const tween = gsap.fromTo(
			cursor.current,
			{ opacity: 1 },
			{
				opacity: 0,
				duration: cursorBlinkDuration,
				repeat: -1,
				yoyo: true,
				ease: "power2.inOut",
			},
		);
		return () => {
			tween.kill();
		};
	}, [cursorBlinkDuration, reducedMotion, showCursor]);
	return (
		<div className="text-type" data-typing={visible !== text}>
			<span className="sr-only" role="img" aria-label={text} />
			<div aria-hidden="true">
				<MessageText text={visible} />
				{showCursor && !reducedMotion && (
					<span ref={cursor} className="text-type-cursor ml-[2px]">
						|
					</span>
				)}
			</div>
		</div>
	);
}
