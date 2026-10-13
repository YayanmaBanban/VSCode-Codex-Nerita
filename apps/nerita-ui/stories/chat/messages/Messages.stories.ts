// 元の表示状態と操作アサーションを Svelte UI へ移行する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, spyOn, userEvent, within, waitFor } from "storybook/test";
import MessagesExample1 from "./MessagesExample1.svelte";
import MessagesExample2 from "./MessagesExample2.svelte";
import MessagesExample3 from "./MessagesExample3.svelte";

const meta = {
	title: "Chat/Messages",
	parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Story = StoryObj<Record<string, never>>;
export const Streaming: Story = {
	render: () => ({ Component: MessagesExample1 }),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		for (const length of [100, 1000]) {
			await userEvent.click(
				canvas.getByRole("button", {
					name: `${length}文字を受信`,
				}),
			);
			const content = canvasElement.querySelector(".message-markdown")!;
			await waitFor(() =>
				expect(content).toHaveTextContent("あ".repeat(length)),
			);
			await userEvent.click(
				canvas.getByRole("button", { name: "追記を受信" }),
			);
			await waitFor(() =>
				expect(content).toHaveTextContent(
					`${"あ".repeat(length)}👨‍👩‍👧‍👦追記`,
				),
			);
			await userEvent.click(
				canvas.getByRole("button", { name: "全文を確定" }),
			);
			await expect(content).toHaveTextContent(
				`${"あ".repeat(length)}👨‍👩‍👧‍👦追記`,
			);
			await userEvent.click(
				canvas.getByRole("button", { name: "本文を訂正" }),
			);
			await waitFor(() =>
				expect(content).toHaveTextContent("訂正 保存済み"),
			);
			await expect(content).not.toHaveTextContent("あ");
		}
	},
};
export const References: Story = {
	render: () => ({ Component: MessagesExample2 }),
};
export const AnswerCopy: Story = {
	render: () => ({ Component: MessagesExample3 }),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const copy = spyOn(navigator.clipboard, "writeText").mockResolvedValue(
			undefined,
		);
		try {
			const button = canvas.getByRole("button", { name: "回答をコピー" });
			await userEvent.click(button);
			await expect(copy).toHaveBeenLastCalledWith(
				"**必要な素材**\n\n- 作戦記録: 75\n- 折金券: 510K",
			);
			await expect(button).toHaveAttribute("data-copy-result", "success");
			await expect(
				canvas.queryByText("コピーしました"),
			).not.toBeInTheDocument();

			copy.mockRejectedValueOnce(new Error("clipboard unavailable"));
			await userEvent.click(button);
			await expect(button).toHaveAttribute("data-copy-result", "error");
			await expect(canvas.queryByRole("status")).not.toBeInTheDocument();
			await userEvent.click(button);
			await expect(button).toHaveAttribute("data-copy-result", "success");
		} finally {
			copy.mockRestore();
		}
	},
};
