// 子と孫のネスト閲覧を再現する固定状態。
import type { SubAgentSummary } from "@nerita/shared/subAgents";

export const child: SubAgentSummary = {
	threadId: "child",
	parentThreadId: "story-session",
	activityItemId: "start",
	agentPath: "/root/reviewer",
	nickname: "swift-cheetah",
	role: "reviewer",
	model: "GPT-5.x",
	reasoningEffort: "High",
	status: "running",
	order: 2,
	iconKey: "cheetah",
};
export const grandchild: SubAgentSummary = {
	...child,
	threadId: "grandchild",
	parentThreadId: "child",
	nickname: "helper",
	agentPath: "/root/reviewer/helper",
};
