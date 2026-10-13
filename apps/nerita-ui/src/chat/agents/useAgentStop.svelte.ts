// 子孫の停止要求を閲覧要求と別に照合し、失敗を保持して再試行可能にする。
import { onDestroy } from "svelte";
import type { Bridge } from "@nerita/shared/bridge";
import type { HostMessage, UiMessage } from "@nerita/shared/messages";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";

/** 停止要求と対象の会話・スレッドを保持し、別の実行先の応答を混同しない。 */
type PendingStop = { requestId: string; threadId: string; sessionId: string };
/** 子スレッドの停止要求を管理する。Svelte の寿命管理内で呼び出し、会話 ID と接続は最新値を返す関数で渡す。 */
export function useAgentStop(
	getBridge: () => Bridge,
	getSessionId: () => string | null,
	send: (message: UiMessage) => void,
) {
	const stop = new AgentStop(getSessionId, send);
	// 初期状態の要求前に停止結果を購読し、Bridge の交換では旧応答待ちを解除する。
	$effect.pre(() => stop.connect(getBridge()));
	onDestroy(() => stop.dispose());
	return stop;
}
/** 同時に1件だけ停止を要求し、セッション切替時に応答待ちを破棄する。 */
class AgentStop {
	pending = $state.raw<PendingStop | undefined>(undefined);
	error = $state.raw<{ threadId: string; text: string } | null>(null);
	private timer: ReturnType<typeof setTimeout> | undefined;
	private readonly getSessionId: () => string | null;
	private readonly send: (message: UiMessage) => void;
	/** 停止先の識別子と Host への送信窓口を保持する。 */
	constructor(
		getSessionId: () => string | null,
		send: (message: UiMessage) => void,
	) {
		this.getSessionId = getSessionId;
		this.send = send;
	}
	/** 接続の切替時は旧応答の購読を解除し、同じ要求の後着を採用しない。 */
	connect(bridge: Bridge) {
		let active = true;
		const unsubscribe = bridge.subscribe((message) => {
			if (active) {
				this.receive(message);
			}
		});
		return () => {
			active = false;
			unsubscribe();
		};
	}
	/** 破棄時に応答待ちのタイマーを解放する。 */
	dispose() {
		clearTimeout(this.timer);
	}
	/** セッション切替時に旧停止要求とエラーを破棄する。 */
	clear() {
		this.pending = undefined;
		this.error = null;
		clearTimeout(this.timer);
	}
	/** 停止要求を一件だけ送り、失敗時は再試行できる状態を残す。 */
	request(threadId: string) {
		const sessionId = this.getSessionId();
		if (this.pending || !isNonEmptyString(sessionId)) {
			return;
		}
		this.error = null;
		const pending = { requestId: crypto.randomUUID(), threadId, sessionId };
		this.pending = pending;
		this.timer = setTimeout(() => this.timedOut(pending), 30000);
		this.send({ type: "agent/stop", ...pending });
	}
	/** 対象の要求がまだ未完了の時だけタイムアウトを通知する。 */
	private timedOut(pending: PendingStop) {
		if (this.pending?.requestId !== pending.requestId) {
			return;
		}
		this.error = {
			threadId: pending.threadId,
			text: "停止要求の応答がありません。表示を更新して状態を確認してください。",
		};
		this.pending = undefined;
	}
	/** 要求 ID とセッションが一致する応答だけを採用する。 */
	private receive(message: HostMessage) {
		const pending = this.pending;
		if (!pending || pending.sessionId !== this.getSessionId()) {
			return;
		}
		if (!("requestId" in message)) {
			return;
		}
		if (message.requestId !== pending.requestId) {
			return;
		}
		if (message.type === "request/failed") {
			this.error = { threadId: pending.threadId, text: message.error };
			this.finish();
			return;
		}
		const stopped =
			message.type === "agent/stopped" &&
			message.threadId === pending.threadId;
		if (stopped) {
			this.finish();
		}
	}
	/** 正常応答と失敗応答の両方で待機タイマーを解除する。 */
	private finish() {
		this.pending = undefined;
		clearTimeout(this.timer);
	}
}
