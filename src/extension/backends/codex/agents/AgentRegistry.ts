// 親ターンのフィルターより先に、子スレッドの状態と活動の重複を管理する。
import type { ChatState } from "../../../../shared/chatState";
import type {
	AgentStatus,
	SubAgentSummary,
} from "../../../../shared/subAgents";
import { isRecord } from "../../../../shared/validation";
import {
	agentItemPatch,
	threadAgentStatus,
	withThreadStatus,
} from "../items/agentItems";
import type { AppServerNotification } from "../protocol/rpcMessage";

/** 接続・会話ごとに隔離するエージェント通知の集約。 */
export class AgentRegistry {
	private scope = "";
	private seen = new Set<string>();
	private statuses = new Map<string, AgentStatus>();
	private metadata = new Map<string, Partial<SubAgentSummary>>();
	/** 過去の会話の通知キャッシュを新しい会話へ引き継がない。 */
	reset(scope: string): void {
		if (this.scope === scope) {
			return;
		}
		this.scope = scope;
		this.seen.clear();
		this.statuses.clear();
		this.metadata.clear();
	}
	/** 状態と開始メタデータはカード生成前にも保持し、協調項目だけでは生成しない。 */
	notification(
		state: ChatState,
		message: AppServerNotification,
	): Partial<ChatState> {
		const p = message.params;
		if (!isRecord(p)) {
			return {};
		}
		if (
			message.method === "thread/status/changed" &&
			typeof p.threadId === "string"
		) {
			const status = threadAgentStatus(p.status);
			if (!status) {
				return {};
			}
			this.statuses.set(p.threadId, status);
			this.trim();
			return {
				agents: state.agents.map((agent) =>
					agent.threadId === p.threadId
						? withThreadStatus(agent, status)
						: agent,
				),
			};
		}
		if (
			message.method === "thread/started" &&
			isRecord(p.thread) &&
			typeof p.thread.id === "string"
		) {
			const threadId = p.thread.id;
			const patch = agentMetadata(p.thread);
			this.metadata.set(p.thread.id, patch);
			this.trim();
			return {
				agents: state.agents.map((agent) =>
					agent.threadId === threadId
						? { ...agent, ...patch }
						: agent,
				),
			};
		}
		return this.activityNotifications(state, message, p);
	}
	/** 親会話と既知の子エージェントの活動だけを反映する。 */
	private activityNotifications(
		state: ChatState,
		message: AppServerNotification,
		p: Record<string, unknown>,
	): Partial<ChatState> {
		if (
			typeof p.threadId !== "string" ||
			(p.threadId !== state.sessionId &&
				!state.agents.some((agent) => agent.threadId === p.threadId))
		) {
			return {};
		}
		const items = notificationItems(message.method, p);
		let current = state;
		for (const item of items) {
			if (
				!isRecord(item) ||
				!["subAgentActivity", "collabAgentToolCall"].includes(
					String(item.type),
				)
			) {
				continue;
			}
			const key = notificationKey(p, item, message);
			if (this.seen.has(key)) {
				continue;
			}
			this.seen.add(key);

			this.clearInteractedStatus(item);
			const patch = agentItemPatch(current, item, p.threadId);
			if (!patch.agents) {
				continue;
			}
			current = {
				...current,
				agents: patch.agents.map((agent) => {
					const status = this.statuses.get(agent.threadId);
					const merged = {
						...agent,
						...this.metadata.get(agent.threadId),
					};
					// 明示的な完了・停止は `idle` より強く、活動開始よりスレッド通知を優先する。
					return status &&
						["running", "idle", "pendingInit"].includes(
							merged.status,
						)
						? withThreadStatus(merged, status)
						: merged;
				}),
			};
		}
		return current === state ? {} : { agents: current.agents };
	}
	/** 再開したエージェントの古い状態キャッシュを消す。 */
	private clearInteractedStatus(item: Record<string, unknown>) {
		if (
			item.type === "subAgentActivity" &&
			item.kind === "interacted" &&
			typeof item.agentThreadId === "string"
		) {
			this.statuses.delete(item.agentThreadId);
		}
	}

	/** 無関係なスレッド通知によるキャッシュの無制限な増加を防ぐ。 */
	private trim(): void {
		for (const map of [this.statuses, this.metadata]) {
			if (map.size > 2048) {
				map.delete(map.keys().next().value!);
			}
		}
	}
}
/** 会話・ターン・項目の組から活動通知の重複キーを作る。 */
function notificationKey(
	p: Record<string, unknown>,
	item: Record<string, unknown>,
	message: AppServerNotification,
) {
	const turnId = p.turnId ?? (isRecord(p.turn) ? p.turn.id : "");
	const key = `${String(p.threadId)}:${String(turnId)}:${String(item.id)}:${activityEventKey(item, message.method)}`;
	return key;
}

/** null を許容するメタデータは既存の表示を消さずに補完する。 */
export function agentMetadata(
	thread: Record<string, unknown>,
): Partial<SubAgentSummary> {
	const result: Partial<SubAgentSummary> = {};
	for (const [source, target] of [
		["agentNickname", "nickname"],
		["agentRole", "role"],
		["model", "model"],
		["reasoningEffort", "reasoningEffort"],
	] as const) {
		if (typeof thread[source] === "string") {
			result[target] = thread[source];
		}
	}
	return result;
}

/** 項目通知とターン完了通知から活動項目を取り出す。 */
function notificationItems(
	method: string,
	p: Record<string, unknown>,
): unknown[] {
	if (["item/started", "item/completed"].includes(method)) {
		return [p.item];
	}
	if (
		method === "turn/completed" &&
		isRecord(p.turn) &&
		Array.isArray(p.turn.items)
	) {
		return p.turn.items;
	}
	return [];
}

/** 活動の種類と開始・完了を重複検出キーへ反映する。 */
function activityEventKey(item: Record<string, unknown>, method: string) {
	if (item.type === "subAgentActivity") {
		return String(item.kind);
	}
	if (method === "item/started") {
		return "started";
	}
	return "completed";
}
