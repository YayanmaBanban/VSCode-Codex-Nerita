// UI の通信契約と Extension Host の寿命管理をバックエンドから独立させる。
import type { WorkflowExecution } from "../../shared/workflows/messages";
import type { ChatState } from "../../shared/chatState";
import type { HostMessage } from "../../shared/messages";

/** Webview が利用する最小のセッション境界。 */
export type ChatSession = {
	snapshot(): ChatState;
	subscribe(listener: (event: HostMessage) => void): () => void;
	receive(value: unknown): Promise<void>;
};

/** ワークスペース変更と拡張終了も扱う Host 側のセッション。 */
export type BackendSession = ChatSession & {
	agentModels?: () => {
		value: string;
		name: string;
		efforts?: string[] | undefined;
	}[];
	workflow?: (
		request: WorkflowExecution,
		signal: AbortSignal,
	) => Promise<string>;
	invalidate(): void;
	dispose(): Promise<void>;
};
