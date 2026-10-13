// 読み取り待ちでもエージェントの表示名をパス末尾から補う。
import { nonEmptyString } from "@nerita/shared/valuePredicates";
import type { SubAgentSummary } from "@nerita/shared/subAgents";
/** 子エージェントの表示名を返す。名前がない場合はパス末尾、最後はスレッド ID を表示に使う。 */
export function agentName(agent: SubAgentSummary): string {
	return (
		nonEmptyString(agent.nickname) ??
		nonEmptyString(agent.agentPath.split("/").filter(Boolean).at(-1)) ??
		agent.threadId
	);
}
