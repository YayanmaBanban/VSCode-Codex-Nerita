// エージェントの寿命と読み取り専用ビューの通信データを定義する。
import type { ChatMessage, ToolSummary } from "./chatState";
import { isRecord } from "./validation";

/** HostとWebviewで共有する同梱アイコンの表示キー。 */
export const agentIconKeys = [
	"cheetah",
	"alien",
	"anubis",
	"cabbage",
	"chochin_obake",
	"daikon",
	"duck",
	"ghost",
	"golden_retriever",
	"kitsune",
	"mendako",
	"penguin",
	"seal",
	"turtle",
] as const;

/** 同梱アイコンだけを指定できるキー。 */
export type AgentIconKey = (typeof agentIconKeys)[number];

/** 履歴の読み直しや通知順序に左右されないアイコンをThread IDから選ぶ。 */
export function agentIconKey(threadId: string): AgentIconKey {
	let hash = 0;
	for (const char of threadId) {
		hash = (Math.imul(hash, 31) + char.codePointAt(0)!) >>> 0;
	}
	return agentIconKeys[hash % agentIconKeys.length]!;
}

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
	iconKey: AgentIconKey;
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
		agentIconKeys.some((key) => key === value.iconKey) &&
		Number.isSafeInteger(value.order)
	);
}
