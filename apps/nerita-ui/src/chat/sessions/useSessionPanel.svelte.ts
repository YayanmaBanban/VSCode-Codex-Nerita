// 履歴ペインの開閉・再取得と狭い画面での操作範囲を管理する。
import { MediaQuery } from "svelte/reactivity";
import { tick } from "svelte";
import type { UiMessage } from "@nerita/shared/messages";
/** 開閉時のフォーカスを保ち、隠れる会話欄への操作を呼び出し側で抑止できる。 */
export function useSessionPanel(send: (message: UiMessage) => void) {
	let open = $state(false);
	const compact = new MediaQuery("(max-width: 759px)");
	/** 同じ操作で閉じるツールチップの状態を反映してからパネルを閉じる。 */
	async function close() {
		await tick();
		open = false;
		document
			.getElementById("session-list-toggle")
			?.focus({ preventScroll: true });
	}
	/** 開くたびに Host の正規の履歴を再取得する。 */
	async function toggle() {
		if (open) {
			await close();
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
