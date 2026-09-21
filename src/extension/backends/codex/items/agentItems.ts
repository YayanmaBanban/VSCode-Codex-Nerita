// 活動イベントと協調ツールのスナップショットを、Thread単位のカードへ正規化する。
import type { ChatState } from "../../../../shared/chatState";
import {
	agentIconKey,
	isAgentStatus,
	type AgentStatus,
	type SubAgentSummary,
} from "../../../../shared/subAgents";
import { isRecord } from "../../../../shared/validation";
import { nextTimelineOrder } from "../../../session/timelineOrder";

/** App ServerのThread状態を表示状態へ変換する。 */
export function threadAgentStatus(value: unknown): AgentStatus | undefined {
	const type = isRecord(value) ? value.type : value;
	return type === "active"
		? "running"
		: type === "idle"
			? "idle"
			: type === "systemError"
				? "systemError"
				: undefined;
}
/** idleは明示的な完了・停止を取り消さない。activeは次の実行として扱う。 */
export function withThreadStatus(
	agent: SubAgentSummary,
	status: AgentStatus,
): SubAgentSummary {
	if (
		status === "idle" &&
		!["running", "idle", "pendingInit"].includes(agent.status)
	) {
		return agent;
	}
	return { ...agent, status };
}
/** 既存カードだけを補完し、活動項目の完了をエージェント完了と混同しない。 */
export function agentItemPatch(
	state: ChatState,
	item: Record<string, unknown>,
	parentThreadId = state.sessionId ?? "history",
): Partial<ChatState> {
	const agents = new Map(
		state.agents.map((agent) => [agent.threadId, agent]),
	);
	if (item.type === "subAgentActivity") {
		if (
			typeof item.agentThreadId !== "string" ||
			!item.agentThreadId ||
			typeof item.agentPath !== "string" ||
			!item.agentPath ||
			typeof item.id !== "string" ||
			!["started", "interacted", "interrupted", "completed"].includes(
				String(item.kind),
			)
		) {
			throw new Error("Invalid agent activity");
		}
		const previous = agents.get(item.agentThreadId);
		if (!previous && item.kind !== "started") {
			return {};
		}
		// 同じ活動のstarted/completed通知やturn最終一覧による再適用を防ぐ。
		if (previous?.activityItemId === item.id) {
			return {};
		}
		const status =
			item.kind === "completed"
				? "completed"
				: item.kind === "interrupted"
					? "interrupted"
					: "running";
		agents.set(item.agentThreadId, {
			...previous,
			threadId: item.agentThreadId,
			parentThreadId,
			activityItemId: item.id,
			agentPath: item.agentPath,
			status,
			iconKey: previous?.iconKey ?? agentIconKey(item.agentThreadId),
			order: previous?.order ?? nextTimelineOrder(state),
		});
	} else if (item.type === "collabAgentToolCall") {
		if (!Array.isArray(item.receiverThreadIds)) {
			throw new Error("Invalid agent receivers");
		}
		for (const id of item.receiverThreadIds) {
			if (typeof id !== "string") {
				throw new Error("Invalid agent receiver");
			}
			const previous = agents.get(id);
			if (!previous) {
				continue;
			}
			const snapshot = isRecord(item.agentsStates)
				? item.agentsStates[id]
				: undefined;
			const patch: Partial<SubAgentSummary> = {};
			if (isRecord(snapshot)) {
				if (isAgentStatus(snapshot.status)) {
					patch.status = snapshot.status;
				}
				if (typeof snapshot.message === "string") {
					patch.statusMessage = snapshot.message;
				}
			}
			for (const key of ["model", "reasoningEffort"] as const) {
				if (typeof item[key] === "string") {
					patch[key] = item[key];
				}
			}
			if (typeof item.tool === "string") {
				patch.lastAction = item.tool;
			}
			agents.set(id, { ...previous, ...patch });
		}
	} else {
		return {};
	}
	return { agents: [...agents.values()] };
}
