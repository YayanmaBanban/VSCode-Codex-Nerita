// 元の表示状態と操作アサーションを Svelte UI へ移行する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import VirtualizationVirtualizationStory from "./VirtualizationVirtualizationStory.svelte";
const meta = {
	title: "Chat/Virtualization",
	component: VirtualizationVirtualizationStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof VirtualizationVirtualizationStory>;
export default meta;
type Story = StoryObj<{ updates?: boolean }>;
export const LongHistory: Story = {};
export const Updates: Story = { args: { updates: true } };
export const RestoreAndAppend: Story = {
	args: { updates: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const conversation = canvas.getByRole("region", { name: /^会話$/ });
		await waitFor(() =>
			expect(canvas.getByText("末尾の検索対象")).toBeVisible(),
		);
		window.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "f",
				ctrlKey: true,
				bubbles: true,
			}),
		);
		const input = await canvas.findByRole("textbox", {
			name: "会話を検索",
		});
		await userEvent.type(input, "履歴 80:");
		await waitFor(() =>
			expect(canvas.getByLabelText("検索結果")).toHaveTextContent("1/1"),
		);
		await userEvent.keyboard("{Escape}");
		const row = () =>
			conversation.querySelector<HTMLElement>(
				'[data-entry-key="message:virtual-message-80"]',
			);
		await waitFor(() => expect(row()).toBeVisible());
		const offset =
			row()!.getBoundingClientRect().top -
			conversation.getBoundingClientRect().top;
		await userEvent.click(
			canvas.getByRole("button", { name: "エディタグループへ移動" }),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "メッセージの末尾へ移動" }),
		);
		await waitFor(() => expect(row()).not.toBeInTheDocument());
		await userEvent.click(
			canvas.getByRole("button", { name: "復元通知を受信" }),
		);
		await waitFor(() => expect(row()).toBeVisible());
		await waitFor(() =>
			expect(
				Math.abs(
					row()!.getBoundingClientRect().top -
						conversation.getBoundingClientRect().top -
						offset,
				),
			).toBeLessThan(2),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "応答を受信" }),
		);
		await waitFor(() =>
			expect(
				conversation.querySelector("[data-entry-count]"),
			).toHaveAttribute("data-entry-count", "401"),
		);
		await expect(row()).toBeVisible();
		await expect(
			conversation.querySelectorAll("[data-entry-key]").length,
		).toBeLessThan(40);
		await userEvent.click(
			canvas.getByRole("button", { name: "メッセージの末尾へ移動" }),
		);
		await waitFor(() =>
			expect(canvas.getByText("新着の応答")).toBeVisible(),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "承認を受信" }),
		);
		await waitFor(() =>
			expect(
				canvas.getByRole("button", { name: "今回のみ許可" }),
			).toBeVisible(),
		);
	},
};
export const SearchAndExpansion: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const conversation = canvas.getByRole("region", {
			name: /^会話$/,
		});
		await waitFor(() =>
			expect(canvas.getByText("末尾の検索対象")).toBeVisible(),
		);
		await expect(
			canvas.queryByText("先頭の検索対象"),
		).not.toBeInTheDocument();
		await expect(
			conversation.querySelectorAll("[data-entry-key]").length,
		).toBeLessThan(40);
		window.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "f",
				ctrlKey: true,
				bubbles: true,
			}),
		);
		const input = await canvas.findByRole("textbox", {
			name: "会話を検索",
		});
		await userEvent.type(input, "折り畳み検索対象");
		await waitFor(() =>
			expect(canvas.getByText(/折り畳み検索対象/)).toBeVisible(),
		);
		const heading = canvas.getByRole("button", {
			name: /^冒頭ツール/,
			expanded: true,
		});
		await expect(heading).toBeVisible();
		await expect(
			conversation.querySelectorAll("[data-entry-key]").length,
		).toBeLessThan(40);
		await userEvent.keyboard("{Escape}");
		await userEvent.click(
			canvas.getByRole("button", { name: "メッセージの末尾へ移動" }),
		);
		await waitFor(() =>
			expect(
				canvas.queryByRole("button", { name: /^冒頭ツール/ }),
			).not.toBeInTheDocument(),
		);
		conversation.scrollTop = 0;
		conversation.dispatchEvent(new Event("scroll"));
		await waitFor(() =>
			expect(
				canvas.getByRole("button", {
					name: /^冒頭ツール/,
					expanded: true,
				}),
			).toBeVisible(),
		);
		await expect(canvas.getByText(/折り畳み検索対象/)).toBeVisible();
	},
};
