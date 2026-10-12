// Host の版番号を確認し、復元と差分購読を会話ごとの Svelte 状態へ接続する。
import { tick } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import { type ChatState, initialState } from "@nerita/shared/chatState";
import type { UiMessage, HostMessage } from "@nerita/shared/messages";
import type { Bridge } from "@nerita/shared/bridge";
import { applyStatePatch } from "@nerita/shared/toolUpdates";

/** Bridge の切り替えで購読を解除し、Host の確定状態だけを公開する。 */
export function useChat(getBridge: () => Bridge) {
	let state = $state.raw<ChatState>(initialState());
	let requestError = $state<string | null>(null);
	const dedicatedRequests = new SvelteSet<string>();
	/** 専用要求の応答は入力領域に任せ、全体の操作エラーを消して送信する。 */
	function send(message: UiMessage) {
		const dedicated =
			message.type === "prompt/send" || message.type === "agent/stop";
		if (dedicated) {
			dedicatedRequests.add(message.requestId);
		}
		requestError = null;
		getBridge().postMessage(message);
	}
	/** 外部接続の変更だけを監視し、古い接続からの通知を失効させる。 */
	function connect() {
		const bridge = getBridge();
		let current = initialState();
		let ready = false;
		let active = true;
		state = current;
		requestError = null;
		dedicatedRequests.clear();
		/** 順序の逆転と差分欠落を検知し、別の会話のエラーを持ち越さない。 */
		function receive(message: HostMessage) {
			if (!active) {
				return;
			}
			if (consumeDedicatedResult(message, dedicatedRequests)) {
				return;
			}
			if (isAuxiliaryMessage(message)) {
				return;
			}
			if (message.type === "request/failed") {
				requestError = message.error;
				return;
			}
			const previous = current;
			if (message.type === "state/snapshot") {
				if (isStaleSnapshot(ready, message.state, current)) {
					return;
				}
				current = message.state;
				ready = true;
			} else {
				if (message.revision <= current.revision) {
					return;
				}
				if (requiresSnapshot(ready, message, current)) {
					bridge.postMessage({ type: "ui/ready" });
					return;
				}
				current = applyStatePatch(current, message);
			}
			if (conversationChanged(previous, current)) {
				requestError = null;
			}
			state = current;
		}
		const unsubscribe = bridge.subscribe(receive);
		// 子の下書き・表示位置の購読も登録してから、同期応答する Bridge へ ready を送る。
		void tick().then(() => {
			if (active) {
				bridge.postMessage({ type: "ui/ready" });
			}
		});
		return () => {
			active = false;
			unsubscribe();
		};
	}
	// Bridge の交換で旧応答を失効させ、購読と初期状態の取得を新しい接続へ切り替える。
	$effect(connect);
	return {
		/** Host の最新の確定状態。 */
		get state() {
			return state;
		},
		/** 表示中の会話に属する操作エラー。 */
		get requestError() {
			return requestError;
		},
		send,
	};
}

/** 表示中の会話や実行対象の変更を判定する。 */
function conversationChanged(previous: ChatState, current: ChatState): boolean {
	return (
		current.sessionId !== previous.sessionId ||
		current.runId !== previous.runId
	);
}

/** 初回の復元以降は、古いスナップショットで確定状態を巻き戻さない。 */
function isStaleSnapshot(
	ready: boolean,
	next: ChatState,
	current: ChatState,
): boolean {
	return ready && next.revision < current.revision;
}

/** フォームや子エージェントが購読する応答を、全体へ重複表示しない。 */
function consumeDedicatedResult(
	message: HostMessage,
	requests: Set<string>,
): boolean {
	const accepted =
		message.type === "prompt/accepted" || message.type === "agent/stopped";
	if (accepted) {
		requests.delete(message.requestId);
		return true;
	}
	return (
		message.type === "request/failed" && requests.delete(message.requestId)
	);
}

/** 初回または基準版の欠落時にスナップショットを再取得する。 */
function requiresSnapshot(
	ready: boolean,
	message: Extract<HostMessage, { type: "state/patch" }>,
	current: ChatState,
) {
	return (
		!ready ||
		(message.baseRevision ?? message.revision - 1) !== current.revision
	);
}

/** 会話の確定状態以外の通知は、専用の購読へ渡す。 */
function isAuxiliaryMessage(
	message: HostMessage,
): message is Exclude<
	HostMessage,
	{ type: "state/snapshot" | "state/patch" | "request/failed" }
> {
	return [
		"dlc/state",
		"dlc/editorState",
		"workspace/trustState",
		"tool/outputResult",
		"ui/codeBlock",
		"ui/viewState",
		"agent/view",
		"agent/stopped",
		"prompt/accepted",
		"workspace/paths",
		"workspace/resolvedPath",
		"workspace/symbols",
		"session/references",
		"ui/sidebarState",
		"ui/backendState",
	].includes(message.type);
}
