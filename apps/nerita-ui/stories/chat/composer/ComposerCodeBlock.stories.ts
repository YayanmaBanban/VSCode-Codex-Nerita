import { expect, userEvent, within, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import CodeBlockStory from "./CodeBlockStory.svelte";

const meta = {
	title: "Chat/Composer Code Block",
	component: CodeBlockStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CodeBlockStory>;

export default meta;

/** 選択範囲と通知の対応を確認するストーリー。 */
type Story = StoryObj<typeof meta>;

export const Selection: Story = {};

/** 複数行の貼り付けを構造化し、1回の取り消しで貼り付け前へ戻す。 */
export const PasteBlockHistory: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const input = canvas.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		const output = canvas.getByLabelText("下書き");
		const text = "one\ntwo\nthree\nfour\nfive";
		await userEvent.click(input);
		await userEvent.clear(input);
		await userEvent.paste(text);
		await waitFor(() =>
			expect(output).toHaveTextContent(
				`"type":"pasted","text":${  JSON.stringify(text)}`,
			),
		);
		await userEvent.keyboard("{Control>}z{/Control}");
		await waitFor(() =>
			expect(output).not.toHaveTextContent('"type":"pasted"'),
		);
		await expect(input).toHaveTextContent("");
		await userEvent.keyboard("{Control>}y{/Control}");
		await waitFor(() =>
			expect(output).toHaveTextContent(
				`"type":"pasted","text":${  JSON.stringify(text)}`,
			),
		);
	},
};
