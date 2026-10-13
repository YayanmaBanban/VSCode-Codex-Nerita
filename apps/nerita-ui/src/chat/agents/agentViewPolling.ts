// 子スレッドの閲覧要求を直列化し、古い応答と破棄後のタイマーを除外する。
import type { Bridge } from "@nerita/shared/bridge";
import type { HostMessage } from "@nerita/shared/messages";
import type { AgentThreadView } from "@nerita/shared/subAgents";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";

type PollingTarget = { sessionId: string; threadId: string };
type PollingReceiver = {
	view: (view: AgentThreadView) => void;
	error: (error: string | null) => void;
	loading: (loading: boolean) => void;
};
/** 読み取りのポーリングは会話を表示している間だけ続け、実行自体は停止しない。 */
export class AgentViewPolling {
	private requestId: string | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private timeout: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;
	private readonly unsubscribe: () => void;
	/** 取得要求を送る前に応答の購読を登録する。 */
	constructor(
		private readonly bridge: Bridge,
		private readonly target: PollingTarget,
		private readonly receiver: PollingReceiver,
	) {
		this.unsubscribe = bridge.subscribe((message) => this.receive(message));
	}
	/** 応答待ちの間は重複要求を送らず、要求 ID を先に保持する。 */
	read() {
		if (isNonEmptyString(this.requestId) || this.disposed) {
			return;
		}
		clearTimeout(this.timer);
		this.requestId = crypto.randomUUID();
		this.receiver.loading(true);
		this.receiver.error(null);
		this.timeout = setTimeout(() => this.timedOut(), 30000);
		this.bridge.postMessage({
			type: "agent/read",
			requestId: this.requestId,
			...this.target,
		});
	}
	/** 古い要求 ID を無効にして利用者に再試行を案内する。 */
	private timedOut() {
		this.requestId = undefined;
		this.receiver.loading(false);
		this.receiver.error(
			"会話の取得がタイムアウトしました。再試行してください。",
		);
	}
	/** 照合済みの応答で表示を更新し、次の読み取りを予約する。 */
	private receive(message: HostMessage) {
		if (this.disposed) {
			return;
		}
		if (!isPendingReply(message, this.requestId)) {
			return;
		}
		clearTimeout(this.timeout);
		this.requestId = undefined;
		this.receiver.loading(false);
		if (message.type === "request/failed") {
			this.receiver.error(message.error);
			return;
		}
		if (message.view.threadId === this.target.threadId) {
			this.receiver.view(message.view);
			this.timer = setTimeout(() => this.read(), 2000);
		}
	}
	/** 会話表示の破棄後にポーリングや応答が残らないようにする。 */
	dispose() {
		this.disposed = true;
		clearTimeout(this.timer);
		clearTimeout(this.timeout);
		this.unsubscribe();
	}
}
/** タイムアウト後や別用途の応答を閲覧のポーリングへ渡さない。 */
function isPendingReply(
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
