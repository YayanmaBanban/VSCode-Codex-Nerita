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

/** 操作対象の説明先だけを確認し、入力欄の操作ヘルプをツールチップの代わりに数えない。 */
async function visibleTooltip(trigger: HTMLElement) {
	return waitFor(async () => {
		const id = trigger.getAttribute("aria-describedby");
		const tooltip =
			id === null ? null : trigger.ownerDocument.getElementById(id);
		await expect(tooltip).toHaveAttribute("role", "tooltip");
		await expect(tooltip).toBeVisible();
		return tooltip;
	});
}

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
				`"type":"pasted","text":${JSON.stringify(text)}`,
			),
		);
		const remove = canvas.getByRole("button", {
			name: "コードブロックを削除",
		});
		await expect(remove).not.toHaveAttribute("title");
		await userEvent.hover(remove);
		const tooltip = await visibleTooltip(remove);
		await userEvent.unhover(remove);
		await userEvent.keyboard("{Control>}z{/Control}");
		await waitFor(() =>
			expect(output).not.toHaveTextContent('"type":"pasted"'),
		);
		await expect(input).toHaveTextContent("");
		await waitFor(() => expect(tooltip).not.toBeInTheDocument());
		await userEvent.keyboard("{Control>}y{/Control}");
		await waitFor(() =>
			expect(output).toHaveTextContent(
				`"type":"pasted","text":${JSON.stringify(text)}`,
			),
		);
		await userEvent.hover(
			canvas.getByRole("button", { name: "コードブロックを削除" }),
		);
		await visibleTooltip(
			canvas.getByRole("button", { name: "コードブロックを削除" }),
		);
	},
};

/** Lexical が生成・破棄するリンクにも共通ツールチップを付け、編集で消えた後に表示を残さない。 */
export const InlineLinkTooltip: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const input = canvas.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		await userEvent.clear(input);
		await userEvent.type(input, "https://example.com ");
		const link = await canvas.findByRole("link", {
			name: "https://example.com",
		});
		await expect(link).not.toHaveAttribute("title");
		await userEvent.hover(link);
		const tooltip = await visibleTooltip(link);
		await userEvent.clear(input);
		await waitFor(() => expect(tooltip).not.toBeInTheDocument());
	},
};
