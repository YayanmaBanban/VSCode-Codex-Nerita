// Pi の並列の子を閲覧しながら、個別承認と親の停止を操作する状態を再現する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { piAgentState } from "./fixtures/piAgents";
import { StoryChat as ChatApp } from "./StoryChat";
import { createChatStoryBridge } from "./mocks/mockBridge";

/** 同名の子を別タスクとして識別できる表示データ。 */
function PiAgentsStory({ background = false }: { background?: boolean }) {
	const bridge = useMemo(() => {
		const mock = createChatStoryBridge("streaming", "pi");
		const { agents, permissions } = piAgentState();
		mock.patchState({
			agents,
			permissions,
			...(background ? { run: "completed" as const } : {}),
		});
		const post = mock.postMessage.bind(mock);
		mock.postMessage = (message) => {
			post(message);
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
