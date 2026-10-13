// 展開位置だけを保存し、UI の破棄によって実行中の Run を変更しない。
import { untrack } from "svelte";

import type { Bridge } from "@nerita/shared/bridge";
import type { DlcEditorState } from "@nerita/shared/dlc/contracts";

/** DLC の展開位置を購読する。Svelte の寿命管理内で呼び出し、接続を交換する場合は取得関数を渡す。 */
export function useDlcEditor(bridge: Bridge | (() => Bridge)) {
	const getBridge = typeof bridge === "function" ? bridge : () => bridge;
	let state = $state.raw<DlcEditorState>({ expanded: {} });
	let error = $state<string | null>(null);
	// 初期応答を取りこぼさないよう描画前に購読を張り替え、旧接続の表示状態を破棄する。
	$effect.pre(() => {
		const bridge = getBridge();
		untrack(() => {
			state = { expanded: {} };
			error = null;
		});
		let active = true;
		const unsubscribe = bridge.subscribe((message) => {
			if (!active) {
				return;
			}
			if (message.type === "dlc/editorState") {
				state = message.state;
			}
			if (message.type === "request/failed") {
				error = message.error;
			}
			if (message.type === "dlc/state" && message.view.error === null) {
				error = null;
			}
		});
		return () => {
			active = false;
			unsubscribe();
		};
	});
	return {
		get state() {
			return state;
		},
		get error() {
			return error;
		},
		toggle(intentId: string, phase: number, initial: number[]) {
			const expanded = state.expanded[intentId] ?? initial;
			state = {
				expanded: {
					...state.expanded,
					[intentId]: expanded.includes(phase)
						? expanded.filter((value) => value !== phase)
						: [...expanded, phase],
				},
			};
			getBridge().postMessage({
				type: "dlc/editorState",
				requestId: crypto.randomUUID(),
				state,
			});
		},
	};
}
