// UIの通信契約とExtension Hostの寿命管理をbackendから独立させる。
import type { ChatState } from "../../shared/chatState";
import type { HostMessage } from "../../shared/messages";

/** Webviewが利用する最小のセッション境界。 */
export type ChatSession = {
	snapshot(): ChatState;
	subscribe(listener: (event: HostMessage) => void): () => void;
	receive(value: unknown): Promise<void>;
};

/** ワークスペース変更と拡張終了も扱うHost側のセッション。 */
export type BackendSession = ChatSession & {
	invalidate(): void;
	dispose(): Promise<void>;
};
