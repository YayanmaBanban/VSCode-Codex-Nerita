// Agent の状態一覧と、親の下書きを保持する子・孫スレッド閲覧を再現する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { agentIconKeys, type SubAgentSummary } from "@nerita/shared/subAgents";
import { StoryChat as ChatApp, storyBridge } from "./StoryChat";
import { AgentCard } from "../../src/chat/agents/AgentCard";
import { createChatStoryBridge } from "./mocks/mockBridge";

const child: SubAgentSummary = {
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
const grandchild: SubAgentSummary = {
	...child,
	threadId: "grandchild",
	parentThreadId: "child",
	nickname: "helper",
	agentPath: "/root/reviewer/helper",
};
/** 子の読み取りだけをモックし、画面と戻る操作は実装を使う。 */
function AgentsStory({ running = false }: { running?: boolean }) {
	const bridge = useMemo(() => {
		const mock = createChatStoryBridge();
		mock.patchState({
			...(running ? { run: "running" as const, runId: "story-run" } : {}),
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
		const post = mock.postMessage.bind(mock);
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
	}, [running]);
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
/** ネスト閲覧を確認するストーリー。 */
type Story = StoryObj<typeof meta>;
export const Viewer: Story = {};
export const StopSubtree: Story = {
	args: { running: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = storyBridge(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: /swift-cheetahの会話/ }),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: /helperの会話/ }),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "自身と子を停止" }),
		);
		await waitFor(() =>
			expect(bridge.sent).toContainEqual(
				expect.objectContaining({
					type: "agent/stop",
					sessionId: "story-session",
					threadId: "grandchild",
				}),
			),
		);
		const request = [...bridge.sent]
			.reverse()
			.find((message) => message.type === "agent/stop")!;
		await expect(
			canvas.getByRole("button", { name: "停止要求中…" }),
		).toBeDisabled();
		bridge.emit({
			type: "request/failed",
			requestId: request.requestId,
			error: "停止できませんでした。",
		});
		await waitFor(() =>
			expect(
				within(
					canvas.getByRole("complementary", {
						name: "エージェントの停止・承認",
					}),
				).getByRole("alert"),
			).toHaveTextContent("停止できませんでした。"),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "自身と子を停止" }),
		);
		await waitFor(() =>
			expect(
				bridge.sent.filter((message) => message.type === "agent/stop"),
			).toHaveLength(2),
		);
		const retry = [...bridge.sent]
			.reverse()
			.find((message) => message.type === "agent/stop")!;
		bridge.patchState({
			agents: [child, { ...grandchild, status: "interrupted" }],
		});
		bridge.emit({
			type: "agent/stopped",
			requestId: retry.requestId,
			threadId: "grandchild",
		});
		await waitFor(() =>
			expect(
				canvas.queryByRole("button", { name: "自身と子を停止" }),
			).not.toBeInTheDocument(),
		);
		await userEvent.click(canvas.getByRole("button", { name: "親へ戻る" }));
		await expect(
			canvas.getByRole("button", { name: "自身と子を停止" }),
		).toBeEnabled();
		await expect(
			bridge.sent.some((message) => message.type === "prompt/cancel"),
		).toBe(false);
	},
};
export const States: Story = { render: () => <StatesStory /> };
export const Icons: Story = {
	render: () => (
		<main className="grid grid-cols-2 gap-3 p-5">
			{agentIconKeys.map((iconKey) => (
				<AgentCard
					key={iconKey}
					agent={{
						...child,
						iconKey,
						nickname: iconKey,
						status: "idle",
					}}
					onOpen={() => {}}
				/>
			))}
		</main>
	),
};
