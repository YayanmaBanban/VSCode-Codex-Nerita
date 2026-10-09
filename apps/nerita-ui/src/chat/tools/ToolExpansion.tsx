// 仮想一覧からカードが外れても、開閉状態だけを会話側に残す。
import {
	createContext,
	useCallback,
	useContext,
	useState,
	type Dispatch,
	type SetStateAction,
} from "react";
import type { ToolSummary } from "@nerita/shared/chatState";
import { toolEntryKey } from "../messages/messageTimeline";

/** 本文や DOM を保持せず、開いたツールの行 ID と開閉操作だけを共有する。 */
export type ToolExpansionState = {
	open: Set<string>;
	setOpen: (tool: ToolSummary, open: boolean) => void;
};
export const ToolExpansion = createContext<ToolExpansionState | null>(null);

/** 新しい会話へ切り替えると、前の会話の開閉状態を解放する。 */
export function useToolExpansion(sessionId: string | null): ToolExpansionState {
	const [state, setState] = useState({ sessionId, open: new Set<string>() });
	if (state.sessionId !== sessionId) {
		setState({ sessionId, open: new Set<string>() });
	}
	const setOpen = useCallback(
		(tool: ToolSummary, open: boolean) => {
			setState((current) => {
				const next = new Set(
					current.sessionId === sessionId ? current.open : [],
				);
				if (open) {
					next.add(toolEntryKey(tool));
				} else {
					next.delete(toolEntryKey(tool));
				}
				return { sessionId, open: next };
			});
		},
		[sessionId],
	);
	return {
		open: state.sessionId === sessionId ? state.open : new Set<string>(),
		setOpen,
	};
}

/** 独立したカードではローカル状態を使い、会話内では親の開閉状態を使う。 */
export function useCardExpansion(
	tool: ToolSummary,
): readonly [{ open: boolean }, Dispatch<SetStateAction<{ open: boolean }>>] {
	const [local, setLocal] = useState({ open: false });
	const expansion = useContext(ToolExpansion);
	const state = expansion
		? { open: expansion.open.has(toolEntryKey(tool)) }
		: local;
	const setState: Dispatch<SetStateAction<{ open: boolean }>> = (value) => {
		if (expansion) {
			expansion.setOpen(
				tool,
				(typeof value === "function" ? value(state) : value).open,
			);
		} else {
			setLocal(value);
		}
	};
	return [state, setState];
}
