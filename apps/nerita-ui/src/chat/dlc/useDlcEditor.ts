// 展開位置だけを利用者のエディタ状態へ保存し、Intent の進捗とは分離する。
import { useEffect, useState } from "react";
import type { Bridge } from "@nerita/shared/bridge";
import type { DlcEditorState } from "@nerita/shared/dlc/contracts";

export function useDlcEditor(bridge: Bridge) {
	const [state, setState] = useState<DlcEditorState>({ expanded: {} });
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		const unsubscribe = bridge.subscribe((message) => {
			if (message.type === "dlc/editorState") {
				setState(message.state);
			}
			if (message.type === "request/failed") {
				setError(message.error);
			}
			if (message.type === "dlc/state" && message.view.error === null) {
				setError(null);
			}
		});
		bridge.postMessage({ type: "ui/ready" });
		return unsubscribe;
	}, [bridge]);
	return {
		state,
		error,
		toggle(intentId: string, phase: number, initial: number[]) {
			const expanded = state.expanded[intentId] ?? initial;
			const next = {
				expanded: {
					...state.expanded,
					[intentId]: expanded.includes(phase)
						? expanded.filter((value) => value !== phase)
						: [...expanded, phase],
				},
			};
			setState(next);
			bridge.postMessage({
				type: "dlc/editorState",
				requestId: crypto.randomUUID(),
				state: next,
			});
		},
	};
}
