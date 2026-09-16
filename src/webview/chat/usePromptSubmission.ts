// 送信受付だけで入力ロックを解除し、失敗した下書きは編集可能なまま残す。
import { useEffect, useRef, useState } from "react";
import type { ChatState, UiMessage } from "../../shared/messages";
import type { Bridge } from "../vscodeBridge";

/** 個別要求の結果と短時間の通知を入力欄へ接続する。 */
export function usePromptSubmission(
	bridge: Bridge,
	state: ChatState,
	draft: string,
	clearDraft: () => void,
	send: (message: UiMessage) => void,
) {
	const pending = useRef<string | null>(null);
	const [locked, setLocked] = useState(false);
	const [notice, setNotice] = useState<{
		id: string;
		text: string;
	} | null>(null);
	const latest = useRef(clearDraft);
	latest.current = clearDraft;
	useEffect(
		() =>
			bridge.subscribe((message) => {
				if (
					(message.type !== "prompt/accepted" &&
						message.type !== "request/failed") ||
					message.requestId !== pending.current
				) {
					return;
				}
				pending.current = null;
				setLocked(false);
				if (message.type === "prompt/accepted") {
					latest.current();
					setNotice(null);
					return;
				}
				setNotice({
					id: message.requestId,
					text: message.error,
				});
			}),
		[bridge],
	);
	useEffect(() => {
		if (state.connection !== "ready" && pending.current) {
			setNotice({
				id: pending.current,
				text: "接続が切れたため、送信を確認できませんでした。",
			});
			pending.current = null;
			setLocked(false);
		}
	}, [state.connection]);
	const available =
		state.connection === "ready" &&
		state.run !== "cancelling" &&
		!locked &&
		!state.sessionPending &&
		!state.configPending &&
		!state.attachmentPending;
	/** 同一イベント内での連打も参照値で防ぐ。下書きは受付後だけ消す。 */
	const submit = () => {
		if (
			!available ||
			pending.current ||
			!draft.trim() ||
			!state.sessionId
		) {
			return;
		}
		const requestId = crypto.randomUUID();
		pending.current = requestId;
		setLocked(true);
		setNotice(null);
		send({
			type: "prompt/send",
			requestId,
			sessionId: state.sessionId,
			text: draft.trim(),
		});
	};
	return {
		locked,
		available,
		submit,
		notice,
		dismissNotice: () => setNotice(null),
	};
}
