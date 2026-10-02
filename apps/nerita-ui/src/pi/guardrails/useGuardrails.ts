// 文書の更新を直列化し、入力中の内容を古い Host 通知で上書きしない。

import {
	type EffectCallback,
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useEffect,
	useRef,
	useState,
} from "react";

import type {
	GuardBridge,
	GuardProbe,
	GuardReply,
	GuardState,
} from "@nerita/shared/guardrails/messages";

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
	useEffect(
		createGuardrailsSubscription(
			host,
			draft,
			setState,
			pending,
			setText,
			setReply,
			bridge,
			setBusy,
		),
		[bridge],
	);
	useEffect(
		createGuardrailsEditEffect(
			state,
			busy,
			text,
			reply,
			sequence,
			pending,
			setBusy,
			bridge,
		),
		[state, text, busy, bridge, reply],
	);
	const change = createGuardrailsDraftUpdater(setReply, draft, setText);
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

/** 入力サイズを検査して未保存の下書きを更新する。 */
function createGuardrailsDraftUpdater(
	setReply: Dispatch<
		SetStateAction<{
			type: "reply";
			id: number;
			error: string | null;
			notice: string;
			result: {
				action: "allow" | "ask" | "deny";
				reasons: string[];
				rules: string[];
				paths: string[];
				uncertainties: string[];
			} | null;
			warnings: string[];
		} | null>
	>,
	draft: RefObject<string>,
	setText: Dispatch<SetStateAction<string>>,
) {
	return (value: string) => {
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
}

/** 最後の入力から150ミリ秒待ち、文書の版を添えて編集要求を送る。 */
function createGuardrailsEditEffect(
	state: GuardState | null,
	busy: boolean,
	text: string,
	reply: {
		type: "reply";
		id: number;
		error: string | null;
		notice: string;
		result: {
			action: "allow" | "ask" | "deny";
			reasons: string[];
			rules: string[];
			paths: string[];
			uncertainties: string[];
		} | null;
		warnings: string[];
	} | null,
	sequence: RefObject<number>,
	pending: RefObject<{ id: number; edit: boolean } | null>,
	setBusy: Dispatch<SetStateAction<boolean>>,
	bridge: GuardBridge,
): EffectCallback {
	return () => {
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
	};
}

/** Host 通知と保留要求を照合し、入力中の文書を保持する。 */
function createGuardrailsSubscription(
	host: RefObject<GuardState | null>,
	draft: RefObject<string>,
	setState: Dispatch<SetStateAction<GuardState | null>>,
	pending: RefObject<{ id: number; edit: boolean } | null>,
	setText: Dispatch<SetStateAction<string>>,
	setReply: Dispatch<
		SetStateAction<{
			type: "reply";
			id: number;
			error: string | null;
			notice: string;
			result: {
				action: "allow" | "ask" | "deny";
				reasons: string[];
				rules: string[];
				paths: string[];
				uncertainties: string[];
			} | null;
			warnings: string[];
		} | null>
	>,
	bridge: GuardBridge,
	setBusy: Dispatch<SetStateAction<boolean>>,
): EffectCallback {
	return () => {
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
	};
}
