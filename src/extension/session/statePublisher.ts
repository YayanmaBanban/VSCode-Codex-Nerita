// 出力だけの連続更新を集約し、変更カードだけをWebviewへ送る。
import type { ToolSummary } from "../../shared/chatState";
import type { HostMessage } from "../../shared/messages";
import { toolKey } from "../../shared/toolUpdates";

/** 集約前の順序番号を保持する状態通知。 */
type PatchMessage = Extract<HostMessage, { type: "state/patch" }>;

/** 正本の更新頻度とUIへの配信頻度を分離する。 */
export class StatePublisher {
	private tools: ToolSummary[] = [];
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
			}
			this.send(message);
			return;
		}
		const previous = this.pending?.patch.tools ?? this.tools;
		const outputOnly = isOutputUpdate(message, previous);
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
	}

	/** 廃棄後のタイマー通知と保持中の出力を解放する。 */
	dispose(): void {
		if (this.timer) {
			clearTimeout(this.timer);
		}
		this.timer = undefined;
		this.pending = undefined;
		this.tools = [];
	}
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
