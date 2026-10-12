// レンダラー内のネイティブ編集が Markdown 入力の保存契約を提供しないことを検証する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, within } from "storybook/test";
import MarkdownEditorProbe from "./MarkdownEditorProbe.svelte";

const meta = {
	title: "Verification/Markdown editor boundary",
	component: MarkdownEditorProbe,
} satisfies Meta<typeof MarkdownEditorProbe>;
export default meta;
type Story = StoryObj<typeof meta>;

export const EditableRenderer: Story = {
	/** 編集可能な DOM を差し込めても、source への逆変換と下書き保存は独自実装が必要。 */
	async play({ canvasElement }) {
		const canvas = within(canvasElement);
		const input = canvas.getByRole("textbox", {
			name: "レンダラー内の入力欄",
		});
		if (import.meta.env.MODE === "test") {
			const { page } = await import("vitest/browser");
			await page
				.getByRole("textbox", { name: "レンダラー内の入力欄" })
				.fill("最初の下書き追記");
		} else {
			await userEvent.click(input);
			document.getSelection()?.selectAllChildren(input);
			await userEvent.keyboard("最初の下書き追記");
		}
		await expect(input).toHaveTextContent("最初の下書き追記");
		await expect(canvas.getByTestId("markdown-source")).toHaveTextContent(
			/^最初の下書き$/,
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "source を変更" }),
		);
		await expect(input).toHaveTextContent("外部から復元した下書き");
		await expect(canvas.getByTestId("markdown-source")).toHaveTextContent(
			"外部から復元した下書き",
		);
	},
};
