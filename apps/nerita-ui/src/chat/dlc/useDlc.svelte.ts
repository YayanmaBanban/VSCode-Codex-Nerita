// Intent の一覧を購読し、Host が管理する実行状態を読み取り専用で公開する。
import { untrack } from "svelte";

import type { Bridge } from "@nerita/shared/bridge";
import type { DlcView } from "@nerita/shared/dlc/contracts";

/** DLC の表示状態を購読する。Svelte の寿命管理内で呼び出し、接続を交換する場合は取得関数を渡す。 */
export function useDlc(bridge: Bridge | (() => Bridge)) {
	const getBridge = typeof bridge === "function" ? bridge : () => bridge;
	const initialView: DlcView = {
		mode: "chat",
		backend: "codex",
		intents: [],
		environment: null,
		selected: null,
		error: null,
		active: null,
		targets: [],
		targetId: null,
		targetBusy: false,
		assignmentPending: false,
		running: [],
		execution: null,
	};
	let view = $state.raw<DlcView>(initialView);
	// 子の初期要求より前に購読を張り替え、旧 Bridge の遅延通知を受け付けなくする。
	$effect.pre(() => {
		const bridge = getBridge();
		untrack(() => {
			view = initialView;
		});
		let active = true;
		const unsubscribe = bridge.subscribe((message) => {
			if (active && message.type === "dlc/state") {
				view = message.view;
			}
		});
		return () => {
			active = false;
			unsubscribe();
		};
	});
	return {
		get view() {
			return view;
		},
	};
}
