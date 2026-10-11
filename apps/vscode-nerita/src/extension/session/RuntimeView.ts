// 表示先ごとに状態の更新番号を持ち、別の会話の差分や再表示を混在させない。
import type { ChatState } from "@nerita/shared/chatState";
import type { HostMessage } from "@nerita/shared/messages";
import type { ChatSession } from "./chatSession";

/** 接続の所有権を持たず、表示先の購読と順序番号だけを管理する。 */
export class RuntimeView implements ChatSession {
	private revision = 0;
	private listeners = new Set<(event: HostMessage) => void>();
	constructor(
		private readonly state: () => ChatState,
		readonly receive: (value: unknown) => Promise<void>,
	) {}
	snapshot(): ChatState {
		return { ...this.state(), revision: this.revision };
	}
	subscribe(listener: (event: HostMessage) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	/** 差分の基準番号は、その表示先へ最後に送った番号とする。 */
	publish(event: HostMessage): void {
		if (event.type === "state/snapshot") {
			event = {
				...event,
				state: { ...event.state, revision: ++this.revision },
			};
		} else if (event.type === "state/patch") {
			const baseRevision = this.revision;
			event = { ...event, baseRevision, revision: ++this.revision };
		}
		for (const listener of this.listeners) {
			listener(event);
		}
	}
	dispose(): void {
		this.listeners.clear();
	}
}
