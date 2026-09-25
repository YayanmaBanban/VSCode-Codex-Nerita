// 閲覧スタックと要求 ID で遅い応答を隔離し、親のチャット状態を保つ。
import { useEffect, useRef, useState } from "react";
import type {
	AgentThreadView,
	SubAgentSummary,
} from "../../../shared/subAgents";
import type { Bridge } from "../../vscodeBridge";

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
	useEffect(() => {
		setView(null);
		setError(null);
		if (!agent || !sessionId) {
			setLoading(false);
			opener.current?.focus({ preventScroll: true });
			opener.current = null;
			return;
		}
		let requestId: string | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let disposed = false;
		/** 同時取得を避け、前の読み取り終了後に次を予約する。 */
		const read = () => {
			if (requestId || disposed) {
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
			}, 30_000);
			bridge.postMessage({
				type: "agent/read",
				requestId,
				sessionId,
				threadId: agent.threadId,
			});
		};
		const unsubscribe = bridge.subscribe((message) => {
			if (
				!requestId ||
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
	}, [bridge, sessionId, agent?.threadId]);
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
