// 会話の正本とUI購読を保持し、単調増加番号付き差分を配信する。
import {
	initialState,
	type ChatState,
	type HostMessage,
} from "../../shared/messages";
/** 接続と実行が共有する状態・承認管理。 */
export class SessionState {
	protected state = initialState();
	private listeners = new Set<(event: HostMessage) => void>();
	/** 外部から正本を変更できないスナップショットを返す。 */
	snapshot(): ChatState {
		return structuredClone(this.state);
	}
	/** UI通知の購読と解除を提供する。 */
	subscribe(listener: (event: HostMessage) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	/** 全購読先へ通知する。 */
	protected emit(event: HostMessage): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
	/** 正本を更新して番号付きの差分を配信する。 */
	protected patch(patch: Partial<Omit<ChatState, "revision">>): void {
		this.state = {
			...this.state,
			...patch,
			revision: this.state.revision + 1,
		};
		this.emit({
			type: "state/patch",
			revision: this.state.revision,
			patch,
		});
	}
	/** 実行と停止待ちをまとめて排他判定する。 */
	protected busy(): boolean {
		return this.state.run === "running" || this.state.run === "cancelling";
	}
	/** 終了時にUI購読を解放する。 */
	protected clearListeners(): void {
		this.listeners.clear();
	}
}
