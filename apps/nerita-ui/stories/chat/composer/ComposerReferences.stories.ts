import { expect, userEvent, within, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import ReferenceStory from "./ReferenceStory.svelte";

const meta = {
	title: "Chat/Composer References",
	component: ReferenceStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ReferenceStory>;

export default meta;

/** 文中にファイル・フォルダのチップを持つ保存済み下書き。 */
type Story = StoryObj<typeof meta>;

export const Restored: Story = {};

/** 参照の取り外し・取り消し・やり直しを、同じ本文の履歴で扱う。 */
export const ReferenceHistory: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const input = canvas.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		const remove = await canvas.findByRole("button", {
			name: "日本語 sample.md の参照を取り外す",
		});
		await userEvent.click(remove);
		await expect(
			canvas.queryByRole("button", {
				name: "日本語 sample.md の参照を取り外す",
			}),
		).not.toBeInTheDocument();
		await waitFor(() => expect(input).toHaveFocus());
		await userEvent.keyboard("{Control>}z{/Control}");
		await expect(
			await canvas.findByRole("button", {
				name: "日本語 sample.md の参照を取り外す",
			}),
		).toBeVisible();
		await userEvent.click(input);
		await userEvent.keyboard("{Control>}y{/Control}");
		await waitFor(() =>
			expect(
				canvas.queryByRole("button", {
					name: "日本語 sample.md の参照を取り外す",
				}),
			).not.toBeInTheDocument(),
		);
		await expect(input).toHaveTextContent("後文");
	},
};
