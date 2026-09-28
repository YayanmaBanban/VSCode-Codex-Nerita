// 子エージェントと個別承認の表示用データ。
import type { Permission } from "../../../shared/chatState";
import type { SubAgentSummary } from "../../../shared/subAgents";
/** 同名の子を固定 ID で識別する。 */
export function piAgentState() {
	const agents: SubAgentSummary[] = ["APIの検査", "画面の検査"].map(
		(task, i) => ({
			threadId: `pi-child-${i}`,
			parentThreadId: "story-session",
			activityItemId: "delegate",
			agentPath: "reviewer",
			nickname: `reviewer ${i + 1}`,
			status: "running",
			statusMessage: task,
			iconKey: i ? "duck" : "cheetah",
			order: i + 2,
		}),
	);
	const permissions: Permission[] = agents.map((agent, i) => ({
		id: `approval-${i}`,
		title: `Pi: ${agent.nickname} の実行承認`,
		fields: [
			{
				id: "subagent",
				label: "サブエージェント",
				value: agent.nickname!,
				display: "text",
			},
			{
				id: "task",
				label: "子のタスク",
				value: agent.statusMessage!,
				display: "text",
			},
		],
		options: [
			{ id: "allow", name: "今回のみ許可", kind: "allow_once" },
			{ id: "reject", name: "拒否", kind: "reject_once" },
		],
	}));

	return { agents, permissions };
}
