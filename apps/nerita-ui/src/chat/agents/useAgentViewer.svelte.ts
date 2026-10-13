// 子スレッドの取得と停止を分離し、閲覧の状態を親セッションの下書きから独立させる。
import { onDestroy, untrack } from "svelte";
import type { Bridge } from "@nerita/shared/bridge";
import type { UiMessage } from "@nerita/shared/messages";
import type {
	AgentThreadView,
	SubAgentSummary,
} from "@nerita/shared/subAgents";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { AgentViewPolling } from "./agentViewPolling";
import { useAgentStop } from "./useAgentStop.svelte";

/** 子スレッドの閲覧状態を保持する。Svelte の寿命管理内で呼び出し、会話 ID と接続は最新値を参照できるようにする。 */
export function useAgentViewer(
	bridge: Bridge | (() => Bridge),
	getSessionId: () => string | null,
	send: (message: UiMessage) => void,
) {
	const getBridge = typeof bridge === "function" ? bridge : () => bridge;
	return new AgentViewerController(getBridge, getSessionId, send);
}
/** 閲覧要求だけを破棄し、Run 自体の寿命は Host に委ねる。 */
class AgentViewerController {
	private stack = $state.raw<SubAgentSummary[]>([]);
	view = $state.raw<AgentThreadView | null>(null);
	error = $state<string | null>(null);
	loading = $state(false);
	private sessionId: string | null;
	private bridge: Bridge;
	private opener: HTMLElement | null = null;
	private polling: AgentViewPolling | undefined;
	private readonly stopController;
	/** セッションの購読と表示の破棄をコンポーネントの寿命へ結び付ける。 */
	constructor(
		getBridge: () => Bridge,
		getSessionId: () => string | null,
		send: (message: UiMessage) => void,
	) {
		this.sessionId = untrack(getSessionId);
		this.bridge = untrack(getBridge);
		this.stopController = useAgentStop(
			getBridge,
			() => this.sessionId,
			send,
		);
		// セッション切替には旧要求とタイマーの破棄が必要なため、派生値にはしない。
		$effect.pre(() => {
			const bridge = getBridge();
			const next = getSessionId();
			untrack(() => this.switchSource(bridge, next));
		});
		onDestroy(() => this.polling?.dispose());
	}
	/** ネストした閲覧で現在の対象だけを公開する。 */
	get agent() {
		return this.stack.at(-1);
	}
	/** 別の子への停止要求も含め、同時の要求を防ぐ。 */
	get stopping() {
		return this.stopController.pending !== undefined;
	}

	/** 停止失敗は閲覧中の子に一致する時だけ表示する。 */
	get stopError() {
		const error = this.stopController.error;
		return error?.threadId === this.agent?.threadId
			? (error?.text ?? null)
			: null;
	}

	/** 旧セッションの閲覧と応答待ちを破棄し、親へのフォーカスを戻す。 */
	private switchSource(bridge: Bridge, next: string | null) {
		if (bridge === this.bridge && next === this.sessionId) {
			return;
		}
		this.bridge = bridge;
		this.sessionId = next;
		this.stack = [];
		this.view = null;
		this.stopController.clear();
		this.startRead();
	}
	/** 閲覧対象が変わるごとに旧要求を破棄し、取得開始前に購読を登録する。 */
	private startRead() {
		this.polling?.dispose();
		this.polling = undefined;
		this.view = null;
		this.error = null;
		const agent = this.agent;
		const sessionId = this.sessionId;
		if (!agent || !isNonEmptyString(sessionId)) {
			this.loading = false;
			this.opener?.focus({ preventScroll: true });
			this.opener = null;
			return;
		}
		this.polling = new AgentViewPolling(
			this.bridge,
			{ sessionId, threadId: agent.threadId },
			{
				view: (view) => {
					this.view = view;
				},
				error: (error) => {
					this.error = error;
				},
				loading: (loading) => {
					this.loading = loading;
				},
			},
		);
		this.polling.read();
	}
	/** 最初の開く操作で復帰先を記録し、子と孫の履歴を保持する。 */
	open = (next: SubAgentSummary) => {
		const active = document.activeElement;
		if (this.stack.length === 0 && active instanceof HTMLElement) {
			this.opener = active;
		}
		this.stack = [...this.stack, next];
		this.startRead();
	};
	/** 一段だけ親へ戻し、親の下書きには触れない。 */
	back = () => {
		this.stack = this.stack.slice(0, -1);
		this.startRead();
	};
	/** 同じ子への再取得を要求し、取得中の重複はポーリング側で防ぐ。 */
	retry = () => {
		this.polling?.read();
	};
	/** 閲覧中の子と子孫だけを Host の停止経路へ渡す。 */
	stop = () => {
		if (this.agent) {
			this.stopController.request(this.agent.threadId);
		}
	};
}
