// 利用者が開いた入力や操作へ、表示後に一度だけフォーカスを移す。
import { useLayoutEffect, useRef } from "react";

/** 有効化されたときだけ移動し、入力中の再描画ではフォーカスやスクロールを奪わない。 */
export function useInitialFocus<T extends HTMLElement>(enabled = true) {
	const ref = useRef<T>(null);
	useLayoutEffect(() => {
		if (enabled) {
			ref.current?.focus({ preventScroll: true });
		}
	}, [enabled]);
	return ref;
}
