// 生成中の本文とツール出力の連続更新を集約し、変更したツールカードは差分で Webview へ送る。
import type { ChatMessage, ToolSummary } from "@nerita/shared/chatState";
import type { HostMessage } from "@nerita/shared/messages";
import { toolKey } from "@nerita/shared/toolUpdates";

/** 集約前の順序番号を保持する状態通知。 */
type PatchMessage = Extract<HostMessage, { type: "state/patch" }>;

/** Host 内の状態更新を集約し、UI への配信頻度を抑える。 */
export class StatePublisher {
	private tools: ToolSummary[] = [];
	private messages: ChatMessage[] = [];
	private pending: PatchMessage | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;

	/** 通信先への送信関数を受け取る。 */
	constructor(private readonly send: (message: HostMessage) => void) {}

	/** 完了・承認・セッション変更は出力の待機時間を引き継がない。 */
	publish(message: HostMessage): void {
		if (message.type !== "state/patch") {
			this.flush();
			if (message.type === "state/snapshot") {
				this.tools = message.state.tools;
				this.messages = message.state.messages;
			}
			this.send(message);
			return;
		}
		const outputOnly = this.canBatch(message);
		this.pending = {
			...message,
			baseRevision: this.pending?.baseRevision ?? message.revision - 1,
			patch: { ...this.pending?.patch, ...message.patch },
		};
		if (!outputOnly) {
			this.flush();
		} else {
			this.timer ??= setTimeout(() => this.flush(), 50);
		}
	}

	/** 待機中の最新状態と比べ、本文・出力だけの更新かを判定する。 */
	private canBatch(message: PatchMessage): boolean {
		return (
			isOutputUpdate(message, this.pending?.patch.tools ?? this.tools) ||
			isMessageUpdate(
				message,
				this.pending?.patch.messages ?? this.messages,
			)
		);
	}

	/** 累積出力は最新だけを送り、削除や並べ替えでは配列を置換する。 */
	flush(): void {
		if (this.timer) {
			clearTimeout(this.timer);
		}
		this.timer = undefined;
		const message = this.pending;
		this.pending = undefined;
		if (!message) {
			return;
		}
		const next = message.patch.tools;
		if (next) {
			if (
				message.patch.sessionId === undefined &&
				next.length >= this.tools.length &&
				this.tools.every(
					(tool, index) => toolKey(tool) === toolKey(next[index]!),
				)
			) {
				message.toolUpdates = next.filter(
					(tool, index) => tool !== this.tools[index],
				);
				delete message.patch.tools;
			}
			this.tools = next;
		}
		this.send(message);
		if (message.patch.messages) {
			this.messages = message.patch.messages;
		}
	}

	/** 破棄時にタイマーを解除し、待機中の通知とツール・メッセージの一覧を解放する。 */
	dispose(): void {
		if (this.timer) {
			clearTimeout(this.timer);
		}
		this.timer = undefined;
		this.pending = undefined;
		this.tools = [];
		this.messages = [];
	}
}

/** 生成中の更新を短時間だけまとめ、本文確定時は待機せず全文を送る。 */
function isMessageUpdate(
	message: PatchMessage,
	previous: ChatMessage[],
): boolean {
	const next = message.patch.messages;
	return (
		next !== undefined &&
		Object.keys(message.patch).every(
			(key) => key === "messages" || key === "sessionTitle",
		) &&
		next.length === previous.length &&
		next.every(
			(item, index) =>
				item === previous[index] ||
				(item.id === previous[index]!.id &&
					item.role === "assistant" &&
					item.streaming === true &&
					previous[index]!.streaming === true),
		)
	);
}

/** 状態遷移やカードの追加を含まない本文更新だけを集約する。 */
function isOutputUpdate(
	message: PatchMessage,
	previous: ToolSummary[],
): boolean {
	const next = message.patch.tools;
	return (
		next !== undefined &&
		Object.keys(message.patch).every(
			(key) => key === "tools" || key === "sessionTitle",
		) &&
		next.length === previous.length &&
		next.every(
			(tool, index) =>
				toolKey(tool) === toolKey(previous[index]!) &&
				tool.status === previous[index]!.status &&
				tool.backgrounded === previous[index]!.backgrounded,
		)
	);
}
