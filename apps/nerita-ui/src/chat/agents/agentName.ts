// 読み取り待ちでもエージェントの表示名をパス末尾から補う。
import { nonEmptyString } from "@nerita/shared/valuePredicates";
import type { SubAgentSummary } from "@nerita/shared/subAgents";
export function agentName(agent: SubAgentSummary): string {
	return (
		nonEmptyString(agent.nickname) ??
		nonEmptyString(agent.agentPath.split("/").filter(Boolean).at(-1)) ??
		agent.threadId
	);
}
