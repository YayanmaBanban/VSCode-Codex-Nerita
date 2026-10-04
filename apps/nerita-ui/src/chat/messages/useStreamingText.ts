// 受信した本文と表示済みの本文を分け、確定通知では文字送りを即座に打ち切る。
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

const characters = new Intl.Segmenter("ja", { granularity: "grapheme" });

/** 絵文字や結合文字も1文字ずつ表示する。利用側はメッセージ ID ごとにコンポーネントをマウントする。 */
export function useStreamingText(text: string, streaming: boolean): string {
	const reducedMotion = useReducedMotion();
	const animate = streaming && !reducedMotion;
	const [displayed, setDisplayed] = useState(animate ? "" : text);
	const received = useRef(text);
	useEffect(() => {
		received.current = text;
		if (!animate) {
			setDisplayed(text);
		}
	}, [text, animate]);
	useEffect(() => {
		if (!animate) {
			return;
		}
		/** 受信が追いつかない間は表示位置を保ち、次の到着を待つ。 */
		function reveal() {
			setDisplayed((previous) => {
				const current = received.current;
				const prefix = current.startsWith(previous) ? previous : "";
				const next = characters
					.segment(current.slice(prefix.length))
					[Symbol.iterator]()
					.next().value;
				return prefix + (next?.segment ?? "");
			});
		}
		const timer = setInterval(reveal, 60);
		return () => clearInterval(timer);
	}, [animate]);
	// エフェクトやタイマーを待たず、本文の確定を反映する描画で全文に切り替える。
	if (!animate) {
		return text;
	}
	return text.startsWith(displayed) ? displayed : "";
}
