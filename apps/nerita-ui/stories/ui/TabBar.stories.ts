// 狭い幅でも送りボタンとキーボードで端の項目へ到達でき、選択状態と無効状態を保つ。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import TabBarPreview from "./TabBarPreview.svelte";

const meta = { title: "UI/TabBar", component: TabBarPreview } satisfies Meta<
	typeof TabBarPreview
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Overflow: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const left = await canvas.findByRole("button", {
			name: "左のタブを表示",
		});
		const right = canvas.getByRole("button", { name: "右のタブを表示" });
		await expect(left).toBeDisabled();
		await userEvent.click(right);
		await waitFor(() => expect(left).toBeEnabled());
		await userEvent.click(canvas.getByRole("button", { name: "JSON" }));
		await expect(
			canvas.getByRole("button", { name: "JSON" }),
		).toHaveAttribute("aria-pressed", "true");
		await waitFor(() => expect(right).toBeDisabled());
		await userEvent.click(left);
		const overview = canvas.getByRole("button", { name: "概要" });
		overview.focus();
		await userEvent.keyboard("{Enter}");
		await expect(overview).toHaveAttribute("aria-pressed", "true");
		await waitFor(() => expect(left).toBeDisabled());
	},
};
export const Fits: Story = {
	args: { width: 700 },
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).queryByRole("button", {
				name: "右のタブを表示",
			}),
		).not.toBeInTheDocument();
	},
};
export const Disabled: Story = {
	args: { disabled: true },
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).getByRole("button", { name: "概要" }),
		).toBeDisabled();
	},
};
