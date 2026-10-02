// 入力中の文書を古い通知で上書きせず、編集の反映後に操作を送る。

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
	WorkflowBridge,
	WorkflowReply,
	WorkflowState,
} from "@nerita/shared/workflows/messages";

/** 文書の版と要求番号を照合し、競合時には入力内容を保持する。 */
export function useWorkflow(bridge: WorkflowBridge) {
	const [state, setState] = useState<WorkflowState | null>(null);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [reply, setReply] = useState<Extract<
		WorkflowReply,
		{ type: "reply" }
	> | null>(null);
	const pending = useRef<{ id: number; edit: boolean; text?: string } | null>(
		null,
	);
	const sequence = useRef(0);
	const draft = useRef("");
	const host = useRef<WorkflowState | null>(null);
	useEffect(
		createWorkflowSubscription(
			host,
			draft,
			setState,
			pending,
			setText,
			setReply,
			bridge,
			acceptEdit,
			setBusy,
		),
		[bridge],
	);
	/** VS Code が改行を正規化した場合も、新しい入力がなければ確定内容へ揃える。 */
	function acceptEdit() {
		if (draft.current === pending.current?.text && host.current) {
			draft.current = host.current.text;
			setText(host.current.text);
		}
	}
	useEffect(
		createWorkflowEditEffect(
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
	const change = createWorkflowDraftUpdater(draft, setText, setReply);
	const request = (type: "save" | "check" | "run") => {
		if (!state || busy || text !== state.text) {
			return;
		}
		const id = ++sequence.current;
		pending.current = { id, edit: false };
		setBusy(true);
		setReply(null);
		bridge.postMessage({ type, id, version: state.version });
	};
	return {
		state,
		text,
		change,
		request,
		reply,
		busy: busy || text !== state?.text,
		locked: (busy && pending.current?.edit === false) || !!state?.running,
		reload: () => {
			if (state) {
				draft.current = state.text;
				setText(state.text);
				setReply(null);
			}
		},
	};
}

/** 入力サイズを検査してワークフローの下書きを更新する。 */
function createWorkflowDraftUpdater(
	draft: RefObject<string>,
	setText: Dispatch<SetStateAction<string>>,
	setReply: Dispatch<
		SetStateAction<{
			type: "reply";
			id: number;
			error: string | null;
			notice: string;
			script?: string | undefined;
		} | null>
	>,
) {
	return (value: string) => {
		if (value.length > 262144) {
			return;
		}
		draft.current = value;
		setText(value);
		setReply(null);
	};
}

/** 実行中や競合時は編集を送らず、入力の終了を待つ。 */
function createWorkflowEditEffect(
	state: WorkflowState | null,
	busy: boolean,
	text: string,
	reply: {
		type: "reply";
		id: number;
		error: string | null;
		notice: string;
		script?: string | undefined;
	} | null,
	sequence: RefObject<number>,
	pending: RefObject<{ id: number; edit: boolean; text?: string } | null>,
	setBusy: Dispatch<SetStateAction<boolean>>,
	bridge: WorkflowBridge,
): EffectCallback {
	return () => {
		if (
			!state ||
			busy ||
			text === state.text ||
			reply?.error ||
			state.running
		) {
			return;
		}
		const timer = window.setTimeout(() => {
			const id = ++sequence.current;
			pending.current = { id, edit: true, text };
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

/** 文書の更新通知を照合し、編集中の内容との競合を検出する。 */
function createWorkflowSubscription(
	host: RefObject<WorkflowState | null>,
	draft: RefObject<string>,
	setState: Dispatch<SetStateAction<WorkflowState | null>>,
	pending: RefObject<{ id: number; edit: boolean; text?: string } | null>,
	setText: Dispatch<SetStateAction<string>>,
	setReply: Dispatch<
		SetStateAction<{
			type: "reply";
			id: number;
			error: string | null;
			notice: string;
			script?: string | undefined;
		} | null>
	>,
	bridge: WorkflowBridge,
	acceptEdit: () => void,
	setBusy: Dispatch<SetStateAction<boolean>>,
): EffectCallback {
	return () => {
		const receiveState = (message: WorkflowState) => {
			const local =
				host.current !== null && draft.current !== host.current.text;
			host.current = message;
			setState(message);
			if (!pending.current?.edit && !local) {
				draft.current = message.text;
				setText(message.text);
			} else if (!pending.current && local) {
				setReply({
					type: "reply",
					id: 0,
					error: "入力中に文書が更新されました。再読み込みするか、編集内容を確認してください。",
					notice: "",
				});
			}
		};
		const unsubscribe = bridge.subscribe((message) => {
			if (message.type === "state") {
				receiveState(message);
			} else if (message.id === 0) {
				setReply(message);
			} else if (pending.current?.id === message.id) {
				if (pending.current.edit && !message.error) {
					acceptEdit();
				}
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
