// 仮想行の DOM を保持せず、会話単位のカード開閉状態だけを共有する。
import { SvelteSet } from "svelte/reactivity";
import { getContext, setContext } from "svelte";
import type { ToolSummary } from "@nerita/shared/chatState";
import type { Bridge } from "@nerita/shared/bridge";
import { toolEntryKey } from "../messages/messageTimeline";

const expansionKey = Symbol("ToolExpansion");
const outputBridgeKey = Symbol("ToolOutputBridge");

/** 会話内の複数カードから参照する開閉操作。 */
export type ToolExpansionState = {
	readonly open: Set<string>;
	setOpen: (tool: ToolSummary, open: boolean) => void;
};

/** セッションが変わると古い会話の ID を解放する。 */
export function useToolExpansion(
	sessionId: () => string | null,
): ToolExpansionState {
	let state = $state.raw({
		sessionId: sessionId(),
		open: new SvelteSet<string>(),
	});
	return {
		get open() {
			return state.sessionId === sessionId()
				? state.open
				: new SvelteSet<string>();
		},
		setOpen(tool, open) {
			const next = new SvelteSet(
				state.sessionId === sessionId() ? state.open : [],
			);
			if (open) {
				next.add(toolEntryKey(tool));
			} else {
				next.delete(toolEntryKey(tool));
			}
			state = { sessionId: sessionId(), open: next };
		},
	};
}

/** Provider の初期化中に呼び、別の会話ツリーとの共有を防ぐ。 */
export function provideToolExpansion(expansion: ToolExpansionState) {
	setContext(expansionKey, expansion);
}

/** 単独カードではローカル状態を使い、会話では親の開閉状態を読む。 */
export function useCardExpansion(tool: () => ToolSummary) {
	const shared = getContext<ToolExpansionState | undefined>(expansionKey);
	let local = $state(false);
	return {
		get open() {
			return shared ? shared.open.has(toolEntryKey(tool())) : local;
		},
		setOpen(open: boolean) {
			if (shared) {
				shared.setOpen(tool(), open);
			} else {
				local = open;
			}
		},
	};
}

/** Host に接続する Bridge を UI ツリーごとに渡す。 */
export function provideToolOutputBridge(bridge: () => Bridge | undefined) {
	setContext(outputBridgeKey, bridge);
}

/** 独立ストーリーでは未設定を許し、取得操作を表示しない。 */
export function useToolOutputBridge() {
	return getContext<(() => Bridge | undefined) | undefined>(outputBridgeKey);
}
