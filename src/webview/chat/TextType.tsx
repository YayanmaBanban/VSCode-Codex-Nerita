// React Bits TextType の逐次表示を、追記されるチャットとコード表示に合わせて構成する。
// 参照: https://reactbits.dev/text-animations/text-type （MIT）
import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";
import { MessageText } from "./MessageText";

/** 一度だけ表示する本文と入力速度の設定。 */
type TextTypeProps = {
	text: string;
	typingSpeed?: number;
};

/** 追記で巻き戻さず、読み上げにはアニメーション前の全文を渡す。 */
export function TextType({ text, typingSpeed = 20 }: TextTypeProps) {
	const reducedMotion = useReducedMotion();
	const [displayed, setDisplayed] = useState("");
	const [revealAll, setRevealAll] = useState(false);
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
	const visible =
		reducedMotion || revealAll
			? text
			: text.startsWith(displayed)
				? displayed
				: "";
	useEffect(() => {
		if (reducedMotion || revealAll || visible === text) {
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
	}, [text, visible, segments, typingSpeed, reducedMotion, revealAll]);
	useEffect(() => {
		// 追記のたびに期限を延ばさず、1.5秒後からは受信済みの全文を表示する。
		const timer = setTimeout(() => setRevealAll(true), 1500);
		return () => clearTimeout(timer);
	}, []);
	return (
		<div className="text-type" data-typing={visible !== text}>
			<span className="sr-only" role="img" aria-label={text} />
			<div aria-hidden="true">
				<MessageText text={visible} />
			</div>
		</div>
	);
}
