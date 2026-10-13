// 履歴ペインの開閉・再取得と狭い画面での操作範囲を管理する。
import { MediaQuery } from "svelte/reactivity";
import type { UiMessage } from "@nerita/shared/messages";
/** 開閉時のフォーカスを保ち、隠れる会話欄への操作を呼び出し側で抑止できる。 */
export function useSessionPanel(send: (message: UiMessage) => void) {
	let open = $state(false);
	const compact = new MediaQuery("(max-width: 759px)");
	/** 閉じた後は一覧を開いたボタンに戻る。 */
	function close() {
		open = false;
		document.getElementById("session-list-toggle")?.focus();
	}
	/** 開くたびに Host の正規の履歴を再取得する。 */
	function toggle() {
		if (open) {
			close();
			return;
		}
		open = true;
		send({ type: "session/list", requestId: crypto.randomUUID() });
	}
	return {
		get open() {
			return open;
		},
		get compact() {
			return compact.current;
		},
		close,
		toggle,
	};
}
