// 元の表示状態と操作アサーションを Svelte UI へ移行する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, within } from "storybook/test";
import MarkdownMarkdownStory from "./MarkdownMarkdownStory.svelte";

const meta = {
	title: "Chat/Markdown",
	component: MarkdownMarkdownStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof MarkdownMarkdownStory>;
export default meta;
type Story = StoryObj<Record<string, never>>;
export const Preview: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const checkboxes = canvas.getAllByRole("checkbox");
		await expect(checkboxes).toHaveLength(2);
		await expect(checkboxes[0]).toBeChecked();
		await expect(checkboxes[1]).not.toBeChecked();
		for (const checkbox of checkboxes) {
			await expect(checkbox).toBeDisabled();
		}
		await expect(
			canvas.getByText('<script>alert("実行しない")</script>', {
				exact: false,
			}),
		).toBeInTheDocument();
		await expect(canvas.getByText("コマンド")).not.toHaveAttribute("href");
		await expect(canvas.getByText("無効なリンク")).not.toHaveAttribute(
			"href",
		);
		await expect(
			canvasElement.querySelector(
				".message-markdown img, .message-markdown script",
			),
		).toBeNull();
	},
};
