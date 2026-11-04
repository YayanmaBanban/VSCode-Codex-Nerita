// 元の表示状態と操作アサーションを Svelte UI へ移行する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, within, userEvent, waitFor } from "storybook/test";
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

/** URL と既存のタイトルをホバーで確認できる。 */
export const LinkDestination: Story = {
	play: async ({ canvasElement }) => {
		const user = userEvent.setup();
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		await user.hover(canvas.getByRole("link", { name: "ドキュメント" }));
		await expect(await page.findByRole("tooltip")).toHaveTextContent(
			"https://example.com/docs",
		);
		await user.unhover(canvas.getByRole("link", { name: "ドキュメント" }));
		await user.hover(
			canvas.getByRole("link", { name: "タイトル付きリンク" }),
		);
		await waitFor(() =>
			expect(page.getByRole("tooltip")).toHaveTextContent(
				"https://example.com/help",
			),
		);
		await expect(page.getByRole("tooltip")).toHaveTextContent(
			"ヘルプの説明",
		);
	},
};

/** Ctrl キーを押しながらクリックすると Host に外部ブラウザーで開くよう1回要求し、ファイルリンクの既存動作を保つ。 */
export const OpenExternalLink: Story = {
	play: async ({ canvasElement }) => {
		const user = userEvent.setup();
		const canvas = within(canvasElement);
		const link = canvas.getByRole("link", { name: "ドキュメント" });
		await user.keyboard("{Control>}");
		try {
			await user.click(link);
		} finally {
			await user.keyboard("{/Control}");
		}
		await expect(
			canvas.getByLabelText("外部ブラウザーで開いたリンク"),
		).toHaveTextContent("https://example.com/docs");
		await userEvent.click(canvas.getByRole("link", { name: "AGENTS.md" }));
		await expect(canvas.getByLabelText("開いたファイル")).toHaveTextContent(
			"file:///AGENTS.md",
		);
	},
};

/** VS Code の標準メニューには Web URL だけを渡し、不正リンクやファイルを含めない。 */
export const LinkContext: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const link = canvas.getByRole("link", { name: "ドキュメント" });
		await expect(
			JSON.parse(link.getAttribute("data-vscode-context")!),
		).toEqual({
			webviewSection: "message-link",
			neritaLinkUrl: "https://example.com/docs",
		});
		for (const name of ["AGENTS.md", "コマンド", "無効なリンク"]) {
			await expect(canvas.getByText(name)).not.toHaveAttribute(
				"data-vscode-context",
			);
		}
	},
};
