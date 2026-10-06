// 閲覧スタックと要求 ID で古い要求への応答を除外し、親のチャット状態を保つ。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";

import {
	type EffectCallback,
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useEffect,
	useRef,
	useState,
} from "react";

import type { Bridge } from "@nerita/shared/bridge";
import type {
	AgentThreadView,
	SubAgentSummary,
} from "@nerita/shared/subAgents";

/** 子・孫の閲覧だけを切り替え、表示中は読み取りを直列で更新する。 */
export function useAgentViewer(bridge: Bridge, sessionId: string | null) {
	const [stack, setStack] = useState<SubAgentSummary[]>([]);
	const [view, setView] = useState<AgentThreadView | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const reload = useRef<() => void>(() => {});
	const opener = useRef<HTMLElement | null>(null);
	const agent = stack.at(-1);
	useEffect(() => {
		setStack([]);
		setView(null);
	}, [sessionId]);
	useEffect(
		() =>
			createAgentViewPolling(
				setView,
				setError,
				agent,
				sessionId,
				setLoading,
				opener,
				bridge,
				reload,
			)(),
		[bridge, sessionId, agent],
	);
	return {
		agent,
		view,
		error,
		loading,
		open: (next: SubAgentSummary) => {
			if (!agent && document.activeElement instanceof HTMLElement) {
				opener.current = document.activeElement;
			}
			setStack((current) => [...current, next]);
		},
		back: () => setStack((current) => current.slice(0, -1)),
		retry: () => reload.current(),
	};
}

/** 閲覧要求を1件ずつ送り、要求 ID の照合とタイムアウトで古い応答を除外する。 */
function createAgentViewPolling(
	setView: Dispatch<SetStateAction<AgentThreadView | null>>,
	setError: Dispatch<SetStateAction<string | null>>,
	agent: undefined | SubAgentSummary,
	sessionId: null | string,
	setLoading: Dispatch<SetStateAction<boolean>>,
	opener: RefObject<HTMLElement | null>,
	bridge: Bridge,
	reload: RefObject<() => void>,
): EffectCallback {
	return () => {
		setView(null);
		setError(null);
		if (!agent || !isNonEmptyString(sessionId)) {
			setLoading(false);
			opener.current?.focus({ preventScroll: true });
			opener.current = null;
			return;
		}
		let requestId: string | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let disposed = false;
		/** 取得中の追加要求を防ぎ、要求 ID を付けて会話を読み込む。 */
		const read = () => {
			if (isNonEmptyString(requestId) || disposed) {
				return;
			}
			clearTimeout(timer);
			requestId = crypto.randomUUID();
			setLoading(true);
			setError(null);
			timeout = setTimeout(() => {
				requestId = undefined;
				setLoading(false);
				setError(
					"会話の取得がタイムアウトしました。再試行してください。",
				);
			}, 30000);
			bridge.postMessage({
				type: "agent/read",
				requestId,
				sessionId,
				threadId: agent.threadId,
			});
		};
		const unsubscribe = bridge.subscribe((message) => {
			if (
				!isNonEmptyString(requestId) ||
				!("requestId" in message) ||
				message.requestId !== requestId
			) {
				return;
			}
			if (
				message.type !== "agent/view" &&
				message.type !== "request/failed"
			) {
				return;
			}
			clearTimeout(timeout);
			requestId = undefined;
			setLoading(false);
			if (message.type === "request/failed") {
				setError(message.error);
			} else if (message.view.threadId === agent.threadId) {
				setView(message.view);
				timer = setTimeout(read, 2000);
			}
		});
		reload.current = read;
		read();
		return () => {
			disposed = true;
			clearTimeout(timer);
			clearTimeout(timeout);
			unsubscribe();
		};
	};
}
