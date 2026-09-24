// Host の順序番号を確認し、会話の復元と差分購読を React に接続する。
import { useEffect, useRef, useState } from "react";
import { type ChatState, initialState } from "../../shared/chatState";
import type { UiMessage, HostMessage } from "../../shared/messages";
import type { Bridge } from "../vscodeBridge";
import { applyStatePatch } from "../../shared/toolUpdates";

/** 接続ごとに状態を初期化し、差分欠落時はスナップショットを要求する。 */
export function useChat(bridge: Bridge) {
	const promptRequests = useRef(new Set<string>());
	const [state, setState] = useState(initialState);
	const [requestError, setRequestError] = useState<string | null>(null);
	useEffect(() => {
		let current = initialState();
		let ready = false;
		setState(current);
		setRequestError(null);
		const unsubscribe = bridge.subscribe((message) => {
			if (message.type === "prompt/accepted") {
				promptRequests.current.delete(message.requestId);
				return;
			}
			if (isAuxiliaryMessage(message)) {
				return;
			}
			if (message.type === "request/failed") {
				if (promptRequests.current.delete(message.requestId)) {
					return;
				}
				setRequestError(message.error);
				return;
			}
			if (message.type === "state/snapshot") {
				if (ready && message.state.revision < current.revision) {
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
			setState(current);
		});
		bridge.postMessage({ type: "ui/ready" });
		return unsubscribe;
	}, [bridge]);
	/** 操作直前に個別要求の古いエラーを消す。 */
	const send = (message: UiMessage) => {
		if (message.type === "prompt/send") {
			promptRequests.current.add(message.requestId);
		}
		setRequestError(null);
		bridge.postMessage(message);
	};
	return { state, requestError, send };
}

/** 初回通知または差分欠落時に全体状態を再取得する。 */
function requiresSnapshot(
	ready: boolean,
	message: {
		type: "state/patch";
		revision: number;
		patch: Partial<Omit<ChatState, "revision">>;
		baseRevision?: number;
	},
	current: ChatState,
) {
	return (
		!ready ||
		(message.baseRevision ?? message.revision - 1) !== current.revision
	);
}

/** 会話状態以外の専用購読へ渡す通知を識別する。 */
function isAuxiliaryMessage(message: HostMessage) {
	return (
		message.type === "ui/codeBlock" ||
		message.type === "ui/viewState" ||
		message.type === "agent/view" ||
		message.type === "workspace/paths" ||
		message.type === "workspace/resolvedPath" ||
		message.type === "workspace/symbols" ||
		message.type === "session/references" ||
		message.type === "ui/sidebarState" ||
		message.type === "ui/sandboxState" ||
		message.type === "ui/backendState"
	);
}
