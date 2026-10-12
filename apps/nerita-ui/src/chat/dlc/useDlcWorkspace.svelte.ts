// 選択と作成の応答を照合し、待機中に旧 Intent を操作しないようにする。
import { untrack } from "svelte";

import type { Bridge } from "@nerita/shared/bridge";
import type { DlcAction, DlcView } from "@nerita/shared/dlc/contracts";
import type { HostMessage } from "@nerita/shared/messages";
import { useDlc } from "./useDlc.svelte";
import { useDlcEditor } from "./useDlcEditor.svelte";
import { currentPhase } from "./phaseModel";

export function useDlcWorkspace(bridge: Bridge | (() => Bridge)) {
	const getBridge = typeof bridge === "function" ? bridge : () => bridge;
	const dlc = useDlc(getBridge);
	const editor = useDlcEditor(getBridge);
	const creation = useIntentCreation(getBridge, () => dlc.view);
	const selection = useIntentSelection(getBridge, () => dlc.view);
	const newIntent = $derived(
		creation.creating || dlc.view.intents.length === 0,
	);

	const selected = $derived(
		newIntent || selection.waiting ? null : dlc.view.selected,
	);
	const expanded = $derived(
		selected
			? (editor.state.expanded[selected.intentId] ?? [
					currentPhase(selected),
				])
			: [0],
	);

	// 全購読の登録後に初期状態を要求し、同期応答も取りこぼさない。
	$effect(() => {
		const bridge = getBridge();
		// 同期応答が触る状態を初期化 effect の依存へ取り込まない。
		untrack(() => bridge.postMessage({ type: "ui/ready" }));
	});
	return {
		get view() {
			return dlc.view;
		},
		editor,
		creation,
		get newIntent() {
			return newIntent;
		},
		get selected() {
			return selected;
		},
		get expanded() {
			return expanded;
		},
		send: (message: Parameters<Bridge["postMessage"]>[0]) =>
			getBridge().postMessage(message),
		select(this: void, intentId: string) {
			creation.setCreating(false);
			selection.select(intentId);
		},
		action(this: void, action: DlcAction) {
			if (selected) {
				getBridge().postMessage({
					type: "dlc/action",
					requestId: crypto.randomUUID(),
					intentId: selected.intentId,
					revision: selected.revision,
					action,
				});
			}
		},
		toggle(this: void, phase: number) {
			if (selected) {
				editor.toggle(selected.intentId, phase, expanded);
			}
		},
	};
}

/** 作成要求が失敗してもフォームを残し、新しい Intent が選択された時だけ閉じる。 */
function useIntentCreation(getBridge: () => Bridge, getView: () => DlcView) {
	let creating = $state(false);
	let pending = $state.raw<{ requestId: string; existing: string[] } | null>(
		null,
	);
	function receiveCreation(message: HostMessage) {
		const failed =
			message.type === "request/failed" &&
			message.requestId === pending?.requestId;
		if (failed) {
			pending = null;
			return;
		}
		if (message.type !== "dlc/state") {
			return;
		}
		if (!pending || !message.view.selected) {
			return;
		}
		const appeared = !pending.existing.includes(
			message.view.selected.intentId,
		);
		if (appeared) {
			pending = null;
			creating = false;
		}
	}
	// 初期要求より先に作成結果を購読し、Bridge の交換では旧要求の待機状態も破棄する。
	$effect.pre(() => {
		const bridge = getBridge();
		untrack(() => {
			pending = null;
			creating = false;
		});
		return guardedSubscription(bridge, receiveCreation);
	});
	return {
		get creating() {
			return creating;
		},
		get pending() {
			return pending !== null;
		},
		setCreating(this: void, value: boolean) {
			creating = value;
		},
		submit(this: void, requestId: string) {
			pending = {
				requestId,
				existing: getView().intents.map((intent) => intent.intentId),
			};
		},
	};
}

/** 解除済みの接続から後着した応答を、選択と作成の待機状態へ渡さない。 */
function guardedSubscription(
	bridge: Bridge,
	receive: (message: HostMessage) => void,
) {
	let active = true;
	const unsubscribe = bridge.subscribe((message) => {
		if (active) {
			receive(message);
		}
	});
	return () => {
		active = false;
		unsubscribe();
	};
}

/** 選択の応答が届くまで、別の Intent の操作内容を表示しない。 */
function useIntentSelection(getBridge: () => Bridge, getView: () => DlcView) {
	let selecting = $state<string | null>(null);
	const waiting = $derived(
		selecting !== null && selecting !== getView().selected?.intentId,
	);
	function receive(message: HostMessage) {
		if (message.type !== "dlc/state") {
			return;
		}
		const resolved =
			selecting === message.view.selected?.intentId ||
			message.view.error !== null;
		if (resolved) {
			selecting = null;
		}
	}
	// 選択結果の購読を初期要求前に登録し、旧接続の応答で別 Intent を選ばないようにする。
	$effect.pre(() => {
		const bridge = getBridge();
		untrack(() => {
			selecting = null;
		});
		return guardedSubscription(bridge, receive);
	});
	return {
		get waiting() {
			return waiting;
		},
		select(this: void, intentId: string) {
			selecting = intentId;
			getBridge().postMessage({
				type: "dlc/select",
				requestId: crypto.randomUUID(),
				intentId,
			});
		},
	};
}
