// 文書の更新を直列化し、入力中の内容を古い Host 通知で上書きしない。
import { useEffect, useRef, useState } from "react";
import type {
	GuardBridge,
	GuardProbe,
	GuardReply,
	GuardState,
} from "../../../shared/guardrails/messages";

/** 編集の反映を待ってから保存・検査を送り、文書バージョンを一致させる。 */
export function useGuardrails(bridge: GuardBridge) {
	const [state, setState] = useState<GuardState | null>(null);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [reply, setReply] = useState<Extract<
		GuardReply,
		{ type: "reply" }
	> | null>(null);
	const pending = useRef<{ id: number; edit: boolean } | null>(null);
	const sequence = useRef(0);
	const draft = useRef("");
	const host = useRef<GuardState | null>(null);
	useEffect(() => {
		const receiveState = (message: GuardState) => {
			const localChanges =
				host.current !== null && draft.current !== host.current.text;
			host.current = message;
			setState(message);
			if (!pending.current?.edit && !localChanges) {
				draft.current = message.text;
				setText(message.text);
			} else if (!pending.current && localChanges) {
				setReply({
					type: "reply",
					id: 0,
					error: "入力中に文書が更新されました。編集内容を確認するか、編集を破棄して再読込してください。",
					notice: "",
					result: null,
					warnings: [],
				});
			}
		};
		const unsubscribe = bridge.subscribe((message) => {
			if (message.type === "state") {
				receiveState(message);
			} else if (pending.current?.id === message.id) {
				if (!pending.current.edit || message.error) {
					setReply(message);
				}
				pending.current = null;
				setBusy(false);
			}
		});
		bridge.postMessage({ type: "ready" });
		return unsubscribe;
	}, [bridge]);
	useEffect(() => {
		if (!state || busy || text === state.text || reply?.error) {
			return;
		}
		const timer = window.setTimeout(() => {
			const id = ++sequence.current;
			pending.current = { id, edit: true };
			setBusy(true);
			bridge.postMessage({
				type: "edit",
				id,
				version: state.version,
				text,
			});
		}, 150);
		return () => window.clearTimeout(timer);
	}, [state, text, busy, bridge, reply]);
	const change = (value: string) => {
		if (value.length > 131072) {
			setReply({
				type: "reply",
				id: 0,
				error: "設定は128 Ki文字以内にしてください。",
				notice: "",
				result: null,
				warnings: [],
			});
			return;
		}
		draft.current = value;
		setReply(null);
		setText(value);
	};
	const request = (type: "save" | "apply" | "check", probe: GuardProbe) => {
		if (!state || busy || text !== state.text) {
			return;
		}
		const id = ++sequence.current;
		pending.current = { id, edit: false };
		setBusy(true);
		setReply(null);
		bridge.postMessage(
			type === "check"
				? { type, id, version: state.version, probe }
				: { type, id, version: state.version },
		);
	};
	return {
		state,
		text,
		change,
		busy: busy || text !== state?.text,
		reply,
		request,
		locked: busy && pending.current?.edit === false,
		conflict: Boolean(reply?.error) && text !== state?.text,
		reload: () => {
			if (state) {
				draft.current = state.text;
				setText(state.text);
				setReply(null);
			}
		},
	};
}
