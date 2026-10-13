// 元の表示状態と操作アサーションを Svelte UI へ移行する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, within } from "storybook/test";
import ActivityToolsActivityToolsStory from "./ActivityToolsActivityToolsStory.svelte";

const meta = {
	title: "Chat/Activity Tools",
	component: ActivityToolsActivityToolsStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ActivityToolsActivityToolsStory>;
export default meta;
type Story = StoryObj<Record<string, never>>;
export const All: Story = {};
export const CompactionProgress: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const title = canvas.getByText("コンテキスト圧縮", { exact: true });
		const card = within(title.closest<HTMLElement>(".tool-card")!);
		await expect(card.getByRole("img", { name: "実行中" })).toBeVisible();
		await expect(
			card.queryByRole("img", { name: "完了" }),
		).not.toBeInTheDocument();
		await expect(card.queryByRole("button")).not.toBeInTheDocument();
		await userEvent.click(
			canvas.getByRole("button", { name: "完了通知を受信" }),
		);
		await expect(card.getByRole("img", { name: "完了" })).toBeVisible();
		await expect(
			card.queryByRole("img", { name: "実行中" }),
		).not.toBeInTheDocument();
	},
};
