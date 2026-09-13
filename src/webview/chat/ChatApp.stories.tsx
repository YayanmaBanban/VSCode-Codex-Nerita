// 接続・会話・承認・障害状態を同じ UI で再現し、基本操作をブラウザで検証する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ChatApp } from "./ChatApp";
import { createMockBridge, type Scenario } from "./mockBridge";

/** 各マウントで独立する Bridge を Story へ注入する。 */
function ChatStory({ scenario }: { scenario: Scenario }) {
	const bridge = useMemo(() => createMockBridge(scenario), [scenario]);
	return <ChatApp bridge={bridge} />;
}
const meta = {
	title: "Chat/App",
	component: ChatStory,
	parameters: { layout: "fullscreen" },
	args: { scenario: "empty" },
} satisfies Meta<typeof ChatStory>;
export default meta;
/** チャット画面の Story 定義。 */
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const Connecting: Story = { args: { scenario: "connecting" } };
export const Authentication: Story = { args: { scenario: "auth" } };
export const Streaming: Story = { args: { scenario: "streaming" } };
export const Completed: Story = { args: { scenario: "completed" } };
export const Permission: Story = { args: { scenario: "permission" } };
export const Cancelled: Story = { args: { scenario: "cancelled" } };
export const Error: Story = { args: { scenario: "error" } };
export const SendMessage: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			canvas.getByRole("textbox"),
			"設定を確認してください",
		);
		await userEvent.click(canvas.getByRole("button", { name: "送信 ↑" }));
		await expect(canvas.getByText("設定を確認してください")).toBeVisible();
		await expect(
			await canvas.findByText(/作業が完了しました/),
		).toBeVisible();
	},
};
