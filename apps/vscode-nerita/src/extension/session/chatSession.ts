// UI の通信契約と Extension Host の寿命管理をバックエンドから独立させる。
import type { WorkflowExecution } from "@nerita/shared/workflows/messages";
import type { ChatState } from "@nerita/shared/chatState";
import type { HostMessage } from "@nerita/shared/messages";
import type { BackendExecutionResult } from "./BackendExecution";

/** Webview が利用する最小のセッション境界。 */
export type ChatSession = {
	snapshot(): ChatState;
	subscribe(listener: (event: HostMessage) => void): () => void;
	receive(value: unknown): Promise<void>;
};

/** ワークスペース変更と拡張終了も扱う Host 側のセッション。 */
export type BackendSession = ChatSession & {
	connect?: () => Promise<void>;
	execute?: (
		prompt: string,
		signal: AbortSignal,
	) => Promise<BackendExecutionResult>;
	cancelExecution?: () => void;
	executionConversation?: () => Promise<ChatState>;
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
