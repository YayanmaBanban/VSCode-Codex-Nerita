// 履歴ペインの開閉・再取得と狭い画面での操作範囲を管理する。
import { useEffect, useState } from "react";
import type { UiMessage } from "../../../shared/messages";

/** 隠れる会話欄へのキーボード操作を防ぎ、開閉時のフォーカスを保つ。 */
export function useSessionPanel(send: (message: UiMessage) => void) {
	const [open, setOpen] = useState(false);
	const [compact, setCompact] = useState(
		() => matchMedia("(max-width: 759px)").matches,
	);
	useEffect(() => {
		const media = matchMedia("(max-width: 759px)");
		const update = () => setCompact(media.matches);
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);
	/** 閉じた後は一覧を開いたボタンに戻る。 */
	const close = () => {
		setOpen(false);
		document.getElementById("session-list-toggle")?.focus();
	};
	/** 開くたびに一覧を再取得する。 */
	const toggle = () => {
		if (open) {
			close();
		} else {
			setOpen(true);
			send({ type: "session/list", requestId: crypto.randomUUID() });
		}
	};
	return { open, compact, close, toggle };
}
