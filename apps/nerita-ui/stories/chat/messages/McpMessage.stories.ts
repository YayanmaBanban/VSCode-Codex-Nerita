// MCP 一覧の取得待ち・失敗・空一覧を、実メッセージ部品で保持して表示する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, within } from "storybook/test";
import McpMessage from "../../../src/chat/messages/McpMessage.svelte";

const meta = {
	title: "Chat/MCP Message",
	component: McpMessage,
	args: { content: { status: "loading" }, text: "" },
} satisfies Meta<typeof McpMessage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {};
export const Error: Story = {
	args: {
		content: { status: "error" },
		text: "MCPサーバーの一覧を取得できませんでした。",
	},
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByRole("alert")).toBeVisible();
	},
};
export const Empty: Story = {
	args: { content: { status: "ready", servers: [] } },
};
export const ServerStates: Story = {
	args: {
		content: {
			status: "ready",
			servers: [
				{ name: "connected-server", runtimeStatus: "connected" },
				{ name: "disabled-server", runtimeStatus: "disabled" },
				{ name: "unknown-server", runtimeStatus: null },
			],
		},
	},
};
