// 会話内検索の開閉、検索語の保持、キーボード操作とフォーカス復帰を確認する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import SearchSearchStory from "./SearchSearchStory.svelte";

const meta = {
	title: "Chat/Search",
	component: SearchSearchStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SearchSearchStory>;
export default meta;
type Story = StoryObj<Record<string, never>>;
export const Ready: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const conversation = canvas.getByRole("region", {
			name: "会話",
		});
		conversation.focus();
		await userEvent.keyboard("{Control>}f{/Control}");
		const input = await canvas.findByRole("textbox", {
			name: "会話を検索",
		});
		await expect(input).toHaveFocus();
		await userEvent.type(input, "補足 10");
		await waitFor(async () => {
			await expect(canvas.getByLabelText("検索結果")).toHaveTextContent(
				"1/1",
			);
		});

		await userEvent.keyboard("{Escape}{Control>}f{/Control}");
		await expect(input).toHaveFocus();
		await expect(input).toHaveValue("補足 10");
		await expect(canvas.getAllByRole("search")).toHaveLength(1);

		await userEvent.click(
			canvas.getByRole("button", { name: "検索を閉じる" }),
		);
		await waitFor(async () => {
			await expect(canvas.queryByRole("search")).toBeNull();
		});
		await expect(conversation).toHaveFocus();
		await userEvent.keyboard("{Control>}f{/Control}");
		await expect(
			await canvas.findByRole("textbox", {
				name: "会話を検索",
			}),
		).toHaveValue("補足 10");
	},
};
