// 接続・会話・承認・障害状態を同じ UI で再現し、基本操作をブラウザで検証する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ChatApp } from "../../webview/chat/ChatApp";
import { createMockBridge, type Scenario } from "./mocks/mockBridge";
import { createAppServerBridge } from "./mocks/appServerBridge";
import { createPiBridge } from "./mocks/piBridge";
import { createPiApprovalBridge } from "./mocks/piApprovalBridge";

/** 各マウントで独立する Bridge を Story へ注入する。 */
function ChatStory({
	scenario,
	appServer = false,
	pi = false,
	piTools = false,
	piApprovals = false,
}: {
	scenario: Scenario;
	appServer?: boolean;
	pi?: boolean;
	piTools?: boolean;
	piApprovals?: boolean;
}) {
	const bridge = useMemo(
		() =>
			piApprovals
				? createPiApprovalBridge()
				: pi || piTools
					? createPiBridge(piTools)
					: appServer
						? createAppServerBridge(scenario)
						: createMockBridge(scenario),
		[scenario, appServer, pi, piTools, piApprovals],
	);
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
export const Pi: Story = { args: { pi: true } };
export const PiTools: Story = { args: { piTools: true } };
export const PiApprovals: Story = { args: { piApprovals: true } };
export const AppServer: Story = { args: { appServer: true } };
export const AppServerStreaming: Story = {
	args: { scenario: "streaming", appServer: true },
};
export const AppServerPermission: Story = {
	args: { scenario: "permission", appServer: true },
};
export const Connecting: Story = { args: { scenario: "connecting" } };
export const Authentication: Story = { args: { scenario: "auth" } };
export const Streaming: Story = { args: { scenario: "streaming" } };
export const Completed: Story = { args: { scenario: "completed" } };
export const Permission: Story = { args: { scenario: "permission" } };
export const Cancelled: Story = { args: { scenario: "cancelled" } };
export const Cancelling: Story = { args: { scenario: "cancelling" } };
export const Failed: Story = { args: { scenario: "failed" } };
export const Error: Story = { args: { scenario: "error" } };
export const SendMessage: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			canvas.getByRole("textbox"),
			"設定を確認してください",
		);
		await userEvent.click(canvas.getByRole("button", { name: "送信" }));
		await expect(canvas.getByText("設定を確認してください")).toBeVisible();
		await expect(
			await canvas.findByText(/作業が完了しました/),
		).toBeVisible();
	},
};
