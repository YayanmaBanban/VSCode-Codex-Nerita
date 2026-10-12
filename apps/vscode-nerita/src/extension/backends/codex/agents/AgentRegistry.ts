// 親ターンのフィルターより先に、子スレッドの状態と活動の重複を管理する。
import type { ChatState } from "@nerita/shared/chatState";
import type { AgentStatus, SubAgentSummary } from "@nerita/shared/subAgents";
import { isRecord } from "@nerita/shared/validation";
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
	/** カード作成前の状態と開始メタデータを保持する。協調ツールの項目だけではカードを作らない。 */
	notification(
		state: ChatState,
		message: AppServerNotification,
	): Partial<ChatState> {
		const p = message.params;
		if (!isRecord(p)) {
			return {};
		}
		if (message.method === "thread/status/changed") {
			return this.threadStatusChanged(state, p);
		}
		if (message.method === "thread/started") {
			return this.threadStarted(state, p);
		}
		return this.activityNotifications(state, message, p);
	}

	/** カードがまだ存在しなくても、検証済みの状態を後続の活動通知へ引き継ぐ。 */
	private threadStatusChanged(
		state: ChatState,
		p: Record<string, unknown>,
	): Partial<ChatState> {
		if (typeof p.threadId !== "string") {
			return {};
		}
		const status = threadAgentStatus(p.status);
		if (status === undefined) {
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

	/** 開始通知のメタデータは既存カードを補完し、通知だけでは新しいカードを作らない。 */
	private threadStarted(
		state: ChatState,
		p: Record<string, unknown>,
	): Partial<ChatState> {
		if (!isRecord(p.thread)) {
			return {};
		}
		if (typeof p.thread.id !== "string") {
			return {};
		}
		const threadId = p.thread.id;
		const patch = agentMetadata(p.thread);
		this.metadata.set(threadId, patch);
		this.trim();
		return {
			agents: state.agents.map((agent) =>
				agent.threadId === threadId ? { ...agent, ...patch } : agent,
			),
		};
	}
	/** 親会話と既知の子エージェントの活動だけを反映する。 */
	private activityNotifications(
		state: ChatState,
		message: AppServerNotification,
		p: Record<string, unknown>,
	): Partial<ChatState> {
		if (typeof p.threadId !== "string") {
			return {};
		}
		const unrelatedThread =
			p.threadId !== state.sessionId &&
			!state.agents.some((agent) => agent.threadId === p.threadId);
		if (unrelatedThread) {
			return {};
		}
		const items = notificationItems(message.method, p);
		let current = state;
		for (const item of items) {
			if (!isRecord(item)) {
				continue;
			}
			const agentActivity = [
				"subAgentActivity",
				"collabAgentToolCall",
			].some((type) => type === item.type);
			if (!agentActivity) {
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
					// 明示的な完了・停止を維持し、それ以外はスレッドの状態通知を活動開始の通知より優先する。
					return status !== undefined &&
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
		if (item.type !== "subAgentActivity" || item.kind !== "interacted") {
			return;
		}
		if (typeof item.agentThreadId !== "string") {
			return;
		}
		this.statuses.delete(item.agentThreadId);
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

	if (typeof p.threadId !== "string") {
		throw new Error("Invalid agent notification ID");
	}
	if (typeof turnId !== "string") {
		throw new Error("Invalid agent notification ID");
	}
	if (typeof item.id !== "string") {
		throw new Error("Invalid agent notification ID");
	}
	const key = `${p.threadId}:${turnId}:${item.id}:${activityEventKey(item, message.method)}`;
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
	if (method !== "turn/completed") {
		return [];
	}
	if (!isRecord(p.turn)) {
		return [];
	}
	if (!Array.isArray(p.turn.items)) {
		return [];
	}
	return p.turn.items;
}

/** 活動の種類と開始・完了を重複検出キーへ反映する。 */
function activityEventKey(item: Record<string, unknown>, method: string) {
	if (item.type === "subAgentActivity") {
		if (typeof item.kind !== "string") {
			throw new Error("Invalid agent activity kind");
		}
		return item.kind;
	}
	if (method === "item/started") {
		return "started";
	}
	return "completed";
}
