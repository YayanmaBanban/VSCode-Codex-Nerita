// Host の順序番号を確認し、会話の復元と差分購読を React に接続する。
import { useEffect, useRef, useState } from "react";
import { initialState } from "../../shared/chatState";
import { type UiMessage } from "../../shared/messages";
import type { Bridge } from "../vscodeBridge";
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
			if (
				message.type === "ui/codeBlock" ||
				message.type === "ui/viewState" ||
				message.type === "agent/view" ||
				message.type === "workspace/paths" ||
				message.type === "workspace/resolvedPath" ||
				message.type === "workspace/symbols" ||
				message.type === "session/references" ||
				message.type === "ui/sidebarState"
			) {
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
				if (!ready || message.revision !== current.revision + 1) {
					bridge.postMessage({ type: "ui/ready" });
					return;
				}
				current = {
					...current,
					...message.patch,
					revision: message.revision,
				};
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
