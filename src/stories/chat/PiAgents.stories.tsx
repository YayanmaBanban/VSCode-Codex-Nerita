// Pi の並列の子を閲覧しながら、個別承認と親の停止を操作する状態を再現する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Permission } from "../../shared/chatState";
import type { SubAgentSummary } from "../../shared/subAgents";
import { ChatApp } from "../../webview/chat/ChatApp";
import { createMockBridge } from "./mocks/mockBridge";

/** 同名の子を別タスクとして識別できる表示データ。 */
function PiAgentsStory({ background = false }: { background?: boolean }) {
	const bridge = useMemo(() => {
		const mock = createMockBridge("streaming", "pi");
		let agents: SubAgentSummary[] = ["APIの検査", "画面の検査"].map(
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
		let permissions: Permission[] = agents.map((agent, i) => ({
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
		mock.patchState({
			agents,
			permissions,
			...(background ? { run: "completed" as const } : {}),
		});
		const post = mock.postMessage;
		mock.postMessage = (message) => {
			if (message.type === "agent/read") {
				mock.emit({
					type: "agent/view",
					requestId: message.requestId,
					view: {
						threadId: message.threadId,
						parentThreadId: "story-session",
						messages: [
							{
								id: "task",
								role: "user",
								text: "指定された対象を検査してください。",
								order: 0,
							},
							{
								id: "answer",
								role: "assistant",
								text: "検査を進めています。",
								order: 1,
							},
						],
						tools: [],
						agents: [],
					},
				});
			} else if (message.type === "permission/respond") {
				permissions = permissions.filter(
					(permission) => permission.id !== message.permissionId,
				);
				mock.patchState({ permissions });
			} else if (message.type === "prompt/cancel") {
				agents = agents.map((agent) => ({
					...agent,
					status: "interrupted",
				}));
				mock.patchState({ agents, permissions: [], run: "cancelled" });
			} else {
				post(message);
			}
		};
		return mock;
	}, [background]);
	return <ChatApp bridge={bridge} />;
}
const meta = {
	title: "Chat/Pi Agents",
	component: PiAgentsStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PiAgentsStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Parallel: Story = {};
export const Background: Story = { args: { background: true } };
