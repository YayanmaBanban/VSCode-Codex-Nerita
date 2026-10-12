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
import type { HostMessage, UiMessage } from "@nerita/shared/messages";
import type {
	AgentThreadView,
	SubAgentSummary,
} from "@nerita/shared/subAgents";

/** 子・孫の閲覧だけを切り替え、表示中は読み取りを直列で更新する。 */
export function useAgentViewer(
	bridge: Bridge,
	sessionId: string | null,
	send: (message: UiMessage) => void,
) {
	const [stack, setStack] = useState<SubAgentSummary[]>([]);
	const [view, setView] = useState<AgentThreadView | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const reload = useRef<() => void>(() => {});
	const opener = useRef<HTMLElement | null>(null);
	const agent = stack.at(-1);
	const stop = useAgentStop(bridge, sessionId, send);
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
		stopping: stop.threadId !== undefined,
		stopError:
			stop.error?.threadId === agent?.threadId
				? (stop.error?.text ?? null)
				: null,
		stop: () => {
			if (agent) {
				stop.request(agent.threadId);
			}
		},
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

/** 停止応答を閲覧要求とは別に照合し、失敗を残して再試行できるようにする。 */
function useAgentStop(
	bridge: Bridge,
	sessionId: string | null,
	send: (message: UiMessage) => void,
) {
	const [pending, setPending] = useState<{
		requestId: string;
		threadId: string;
		sessionId: string;
	}>();
	const [error, setError] = useState<{
		threadId: string;
		text: string;
	} | null>(null);
	useEffect(() => {
		setPending(undefined);
		setError(null);
	}, [sessionId]);
	useEffect(() => {
		if (!pending || pending.sessionId !== sessionId) {
			return;
		}
		/** 停止の要求 ID を照合し、失敗を残してから待機を解除する。 */
		const receiveStopReply: Parameters<Bridge["subscribe"]>[0] = (
			message,
		) => {
			if (!("requestId" in message)) {
				return;
			}
			if (message.requestId !== pending.requestId) {
				return;
			}
			if (message.type === "request/failed") {
				setError({ threadId: pending.threadId, text: message.error });
				setPending(undefined);
				return;
			}
			if (message.type !== "agent/stopped") {
				return;
			}
			if (message.threadId === pending.threadId) {
				setPending(undefined);
			}
		};
		const unsubscribe = bridge.subscribe(receiveStopReply);
		const timer = setTimeout(() => {
			setError({
				threadId: pending.threadId,
				text: "停止要求の応答がありません。表示を更新して状態を確認してください。",
			});
			setPending(undefined);
		}, 30000);
		send({ type: "agent/stop", ...pending });
		return () => {
			clearTimeout(timer);
			unsubscribe();
		};
	}, [bridge, pending, sessionId, send]);
	return {
		threadId: pending?.threadId,
		error,
		request: (threadId: string) => {
			if (pending || !isNonEmptyString(sessionId)) {
				return;
			}
			setError(null);
			setPending({ requestId: crypto.randomUUID(), threadId, sessionId });
		},
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
		/** 対象の閲覧応答だけで待機を解除し、同じ子の表示を更新して次の取得を予約する。 */
		const receiveAgentViewReply: Parameters<Bridge["subscribe"]>[0] = (
			message,
		) => {
			if (!isPendingAgentViewReply(message, requestId)) {
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
		};
		const unsubscribe = bridge.subscribe(receiveAgentViewReply);
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

/** 閲覧要求の ID と応答種別を照合し、タイムアウト後や別用途の応答をポーリングへ渡さない。 */
function isPendingAgentViewReply(
	message: HostMessage,
	requestId: string | undefined,
): message is Extract<HostMessage, { type: "agent/view" | "request/failed" }> {
	if (!isNonEmptyString(requestId)) {
		return false;
	}
	if (!("requestId" in message)) {
		return false;
	}
	if (message.requestId !== requestId) {
		return false;
	}
	return message.type === "agent/view" || message.type === "request/failed";
}
