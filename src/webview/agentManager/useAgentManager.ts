// 保存要求の応答を待ち、失敗した入力を画面に残す。
import { useEffect, useRef, useState } from "react";
import type {
	ManagerBridge,
	ManagerRequest,
	ManagerState,
} from "../../shared/agentManager/messages";

type Mutation = Extract<ManagerRequest, { generation: string }>;
export type ManagerSave = (
	change: Mutation extends infer T
		? T extends Mutation
			? Omit<T, "id" | "generation" | "workspace">
			: never
		: never,
) => void;

/** 再読込を保存から分離し、古い世代を自動的に上書きしない。 */
export function useAgentManager(bridge: ManagerBridge) {
	const [state, setState] = useState<ManagerState>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState("");
	const sequence = useRef(0);
	useEffect(() => {
		const unsubscribe = bridge.subscribe((message) => {
			if (message.type === "state") {
				setState(message);
				setBusy(false);
			} else if (message.id === 0 || message.id === sequence.current) {
				setError(message.error);
				setNotice(message.notice);
				setBusy(false);
			}
		});
		bridge.postMessage({ type: "ready" });
		return unsubscribe;
	}, [bridge]);
	const save: ManagerSave = (change) => {
		if (!state || busy) {
			return;
		}
		setBusy(true);
		setError(null);
		setNotice("");
		bridge.postMessage({
			...change,
			id: ++sequence.current,
			workspace: state.workspace,
			generation: state.generation,
		});
	};
	return {
		state,
		busy,
		error,
		notice,
		save,
		reload: () => {
			setError(null);
			setNotice("");
			setBusy(true);
			bridge.postMessage({ type: "reload" });
		},
	};
}
