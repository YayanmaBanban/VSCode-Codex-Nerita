// 外部 HTML・URL・画像と、メッセージの変更を本体のレンダラーで確認する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import MarkdownOutputProbe from "./MarkdownOutputProbe.svelte";

const meta = {
	title: "Verification/Markdown output",
	component: MarkdownOutputProbe,
} satisfies Meta<typeof MarkdownOutputProbe>;
export default meta;
type Story = StoryObj<typeof meta>;

export const UntrustedMarkup: Story = {
	args: { mode: "security" },
	/** 生 HTML は文字として表示し、画像と実行可能 URL を DOM に持ち込まない。 */
	async play({ canvasElement }) {
		const output = within(canvasElement).getByTestId("output");
		await expect(output).toHaveTextContent("代替テキスト");
		await expect(
			output.querySelectorAll("script,img,iframe,svg"),
		).toHaveLength(0);
		await expect(output).toHaveTextContent(
			"globalThis.__markdownInjection",
		);
		await expect(output).toHaveTextContent(
			"<script>globalThis.__markdownInjection = true</script>",
		);
		await expect(
			within(output).getByRole("checkbox", { checked: true }),
		).toBeDisabled();
		await expect(
			within(output).getByRole("checkbox", { checked: false }),
		).toBeDisabled();
		for (const anchor of output.querySelectorAll("a")) {
			await expect(anchor.getAttribute("href") ?? "").not.toMatch(
				/^(?:javascript|data|vbscript):/i,
			);
		}
		await expect(
			within(output).getByRole("link", { name: "通常" }),
		).toHaveAttribute("href", "https://example.invalid");
	},
};

export const StreamChanges: Story = {
	args: { mode: "stream" },
	/** 追記と書き換えを区別し、ID 変更と確定後に以前の本文を残さない。 */
	async play({ canvasElement }) {
		const canvas = within(canvasElement);
		const output = canvas.getByTestId("output");
		await waitFor(() => expect(output).toHaveTextContent("先頭 👩‍💻"));
		await userEvent.click(canvas.getByRole("button", { name: "追記" }));
		await waitFor(() =>
			expect(output.querySelector("pre code")).toHaveTextContent(
				"const answer = 42;",
			),
		);
		await expect(
			within(output).getByRole("cell", { name: "結果" }),
		).toBeVisible();
		await expect(
			within(output).getByRole("cell", { name: "✅" }),
		).toBeVisible();
		await expect(output.querySelector("br")).not.toBeNull();
		await userEvent.click(
			canvas.getByRole("button", { name: "本文を修正" }),
		);
		await waitFor(() =>
			expect(output).toHaveTextContent("本文を修正した 🧑‍🔧"),
		);
		await expect(output).not.toHaveTextContent("先頭");
		await userEvent.click(
			canvas.getByRole("button", { name: "次のメッセージ" }),
		);
		await userEvent.click(canvas.getByRole("button", { name: "確定" }));
		await expect(output).toHaveTextContent("次のメッセージ 👨‍👩‍👧‍👦");
		await expect(output).not.toHaveTextContent("本文を修正した");
	},
};
