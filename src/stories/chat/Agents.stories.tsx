// Agentの状態一覧と、親の下書きを保持する子・孫Thread閲覧を再現する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { SubAgentSummary } from "../../shared/subAgents";
import { ChatApp } from "../../webview/chat/ChatApp";
import { AgentCard } from "../../webview/chat/agents/AgentCard";
import { createMockBridge } from "./mocks/mockBridge";

const child: SubAgentSummary = {
	threadId: "child",
	parentThreadId: "story-session",
	activityItemId: "start",
	agentPath: "/root/reviewer",
	nickname: "swift-cheetah",
	role: "reviewer",
	model: "GPT-5.x",
	status: "running",
	order: 2,
	iconKey: "cheetah",
};
const grandchild: SubAgentSummary = {
	...child,
	threadId: "grandchild",
	parentThreadId: "child",
	nickname: "helper",
	agentPath: "/root/reviewer/helper",
};
/** 子の読み取りだけをモックし、画面と戻る操作は実装を使う。 */
function AgentsStory() {
	const bridge = useMemo(() => {
		const mock = createMockBridge();
		mock.patchState({
			agents: [child, grandchild],
			messages: [
				{
					id: "user",
					role: "user",
					text: "この機能を調べて",
					order: 1,
				},
				{
					id: "assistant",
					role: "assistant",
					text: "調査を依頼しました。",
					order: 3,
				},
			],
		});
		const post = mock.postMessage;
		mock.postMessage = (message) => {
			if (message.type !== "agent/read") {
				post(message);
				return;
			}
			mock.sent.push(message);
			queueMicrotask(() =>
				mock.emit({
					type: "agent/view",
					requestId: message.requestId,
					view: {
						threadId: message.threadId,
						parentThreadId:
							message.threadId === "child"
								? "story-session"
								: "child",
						messages: [
							{
								id: "child-question",
								role: "user",
								text: "通知処理を調査してください。",
								order: 1,
							},
							{
								id: "child-answer",
								role: "assistant",
								text:
									message.threadId === "child"
										? "通知の処理を確認しました。"
										: "孫エージェントの調査結果です。",
								order: 3,
							},
						],
						tools: [],
						agents:
							message.threadId === "child" ? [grandchild] : [],
					},
				}),
			);
		};
		return mock;
	}, []);
	return <ChatApp bridge={bridge} />;
}
/** 長い名前を含む全状態のカードを比較する。 */
function StatesStory() {
	return (
		<main className="p-5">
			{(
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
				] as const
			).map((status) => (
				<AgentCard
					key={status}
					agent={{
						...child,
						status,
						nickname:
							status === "running"
								? "long-agent-name-for-reviewing-thread-notifications"
								: status,
					}}
					onOpen={() => {}}
				/>
			))}
		</main>
	);
}
const meta = {
	title: "Chat/Agents",
	component: AgentsStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AgentsStory>;
export default meta;
/** ネスト閲覧を確認するStory。 */
type Story = StoryObj<typeof meta>;
export const Viewer: Story = {};
export const States: Story = { render: () => <StatesStory /> };
