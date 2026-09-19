// エージェントの寿命と読み取り専用ビューの通信データを定義する。
import type { ChatMessage, ToolSummary } from "./messages";
import { isRecord } from "./validation";

/** ツール呼び出しの完了とは独立したエージェントの状態。 */
export type AgentStatus =
	| "pendingInit"
	| "running"
	| "idle"
	| "completed"
	| "interrupted"
	| "shutdown"
	| "errored"
	| "systemError"
	| "notFound";
/** Thread IDを識別子とするタイムラインカード。 */
export type SubAgentSummary = {
	threadId: string;
	parentThreadId: string;
	activityItemId: string;
	agentPath: string;
	nickname?: string;
	role?: string;
	status: AgentStatus;
	statusMessage?: string;
	model?: string;
	reasoningEffort?: string;
	lastAction?: string;
	iconKey: "cheetah";
	order: number;
};
/** 親の実行状態とは別に取得する会話のスナップショット。 */
export type AgentThreadView = {
	threadId: string;
	parentThreadId: string | null;
	messages: ChatMessage[];
	tools: ToolSummary[];
	agents: SubAgentSummary[];
};
/** 未知の状態値を表示層へ流さない。 */
export function isAgentStatus(value: unknown): value is AgentStatus {
	return (
		typeof value === "string" &&
		[
			"pendingInit",
			"running",
			"idle",
			"completed",
			"interrupted",
			"shutdown",
			"errored",
			"systemError",
			"notFound",
		].includes(value)
	);
}
/** Hostから渡されるカードの全フィールドを検証する。 */
export function isSubAgent(value: unknown): value is SubAgentSummary {
	return (
		isRecord(value) &&
		["threadId", "parentThreadId", "activityItemId", "agentPath"].every(
			(key) => typeof value[key] === "string" && value[key].length > 0,
		) &&
		[
			"nickname",
			"role",
			"statusMessage",
			"model",
			"reasoningEffort",
			"lastAction",
		].every(
			(key) => value[key] === undefined || typeof value[key] === "string",
		) &&
		isAgentStatus(value.status) &&
		value.iconKey === "cheetah" &&
		Number.isSafeInteger(value.order)
	);
}
