// Host の順序番号を確認し、会話の復元と差分購読を React に接続する。
import { useCallback, useEffect, useRef, useState } from "react";
import { type ChatState, initialState } from "@nerita/shared/chatState";
import type { UiMessage, HostMessage } from "@nerita/shared/messages";
import type { Bridge } from "@nerita/shared/bridge";
import { applyStatePatch } from "@nerita/shared/toolUpdates";

/** 接続ごとに状態を初期化し、差分欠落時はスナップショットを要求する。 */
export function useChat(bridge: Bridge) {
	const dedicatedRequests = useRef(new Set<string>());
	const [state, setState] = useState(initialState);
	const [requestError, setRequestError] = useState<string | null>(null);
	useEffect(() => {
		let current = initialState();
		let ready = false;
		setState(current);
		setRequestError(null);
		dedicatedRequests.current.clear();
		const unsubscribe = bridge.subscribe((message) => {
			if (consumeDedicatedResult(message, dedicatedRequests.current)) {
				return;
			}
			if (isAuxiliaryMessage(message)) {
				return;
			}
			if (message.type === "request/failed") {
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
	/** 操作直前に個別要求の古いエラーを消す。参照を固定して過去の本文の再描画を防ぐ。 */
	const send = useCallback(
		(message: UiMessage) => {
			if (
				message.type === "prompt/send" ||
				message.type === "agent/stop"
			) {
				dedicatedRequests.current.add(message.requestId);
			}
			setRequestError(null);
			bridge.postMessage(message);
		},
		[bridge],
	);
	return { state, requestError, send };
}

/** 送信フォームとエージェント閲覧が扱う結果は、全体エラーへ重複表示しない。 */
function consumeDedicatedResult(
	message: HostMessage,
	requests: Set<string>,
): boolean {
	if (
		message.type === "prompt/accepted" ||
		message.type === "agent/stopped"
	) {
		requests.delete(message.requestId);
		return true;
	}
	return (
		message.type === "request/failed" && requests.delete(message.requestId)
	);
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
function isAuxiliaryMessage(message: HostMessage): message is Exclude<
	HostMessage,
	{
		type: "state/snapshot" | "state/patch" | "request/failed";
	}
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
