// Agent の状態一覧と、親の下書きを保持する子・孫スレッド閲覧を検証する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import AgentsStory from "./AgentsStory.svelte";
import { storyBridge } from "./storyBridgeElement";
import { child, grandchild } from "./agentStoryState";
import type { HostMessage } from "@nerita/shared/messages";
import type { StoryBridge } from "./mocks/storyBridge";
import { view, projection, first, second } from "./dlc/workspaceState";

const meta = {
	title: "Chat/Agents",
	component: AgentsStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AgentsStory>;
export default meta;
/** ネスト閲覧を確認するストーリー。 */
type Story = StoryObj<typeof meta>;
export const Viewer: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByRole("button", { name: /swift-cheetahの会話/ });
		await userEvent.type(
			canvas.getByLabelText("Codexへのメッセージ"),
			"parent draft while reading",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: /swift-cheetahの会話/ }),
		);
		await canvas.findByText("通知の処理を確認しました。");
		await userEvent.click(
			canvas.getByRole("button", { name: /helperの会話/ }),
		);
		await canvas.findByText("孫エージェントの調査結果です。");
		await userEvent.click(canvas.getByRole("button", { name: "親へ戻る" }));
		await canvas.findByText("通知の処理を確認しました。");
		await userEvent.click(canvas.getByRole("button", { name: "親へ戻る" }));
		await expect(
			await canvas.findByLabelText("Codexへのメッセージ"),
		).toHaveTextContent("parent draft while reading");
		await expect(
			storyBridge(canvasElement).sent.some(
				(message) => message.type === "prompt/send",
			),
		).toBe(false);
	},
};
export const StopSubtree: Story = {
	args: { running: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = storyBridge(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: /swift-cheetahの会話/ }),
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
export const States: Story = { args: { display: "states" } };
export const Icons: Story = { args: { display: "icons" } };

/** 古い購読と応答が、新しい Bridge とセッションの表示へ戻り込まない。 */
export const SourceChanges: Story = {
	args: { display: "sources" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		type Source = StoryBridge & {
			listenerCount: number;
			deliverCaptured: (message: HostMessage) => void;
		};
		const element = canvasElement.querySelector<
			HTMLElement & { first: Source; second: Source }
		>("[data-story-sources]")!;
		await expect(
			await canvas.findByText("Intent: 最初の接続"),
		).toBeVisible();
		await userEvent.click(
			canvas.getByRole("button", { name: "子の会話を開く" }),
		);
		const old = element.first.sent.find(
			(message) => message.type === "agent/read",
		);
		if (old?.type !== "agent/read") {
			throw new Error("旧接続の閲覧要求がありません。");
		}
		await userEvent.click(
			canvas.getByRole("button", { name: "接続を切り替え" }),
		);
		await waitFor(() => expect(canvas.getByText("閲覧: 親")).toBeVisible());
		await expect(element.first.listenerCount).toBe(0);
		element.second.emit({
			type: "dlc/state",
			view: view(projection(second, "新しい接続")),
		});
		await userEvent.click(
			canvas.getByRole("button", { name: "子の会話を開く" }),
		);
		const next = element.second.sent.find(
			(message) => message.type === "agent/read",
		);
		if (next?.type !== "agent/read") {
			throw new Error("新しい接続の閲覧要求がありません。");
		}
		const late = agentReply(old.requestId, "古い会話");
		element.first.deliverCaptured(late);
		element.first.deliverCaptured({
			type: "dlc/state",
			view: view(projection(first, "旧接続の後着応答")),
		});
		element.second.emit(agentReply(next.requestId, "新しい会話"));
		await expect(await canvas.findByText("新しい会話")).toBeVisible();
		await expect(canvas.getByText("Intent: 新しい接続")).toBeVisible();
		await expect(canvas.queryByText("古い会話")).not.toBeInTheDocument();
		await expect(
			canvas.queryByText("Intent: 旧接続の後着応答"),
		).not.toBeInTheDocument();
	},
};

/** 要求照合の検証に必要な表示応答だけを用意する。 */
function agentReply(
	requestId: string,
	text: string,
): Extract<HostMessage, { type: "agent/view" }> {
	return {
		type: "agent/view",
		requestId,
		view: {
			threadId: "child",
			parentThreadId: null,
			messages: [{ id: "reply", role: "assistant", text, order: 1 }],
			tools: [],
			agents: [],
		},
	};
}
