// 実際のチャット画面でセッション一覧の各状態を観察する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import SessionsStory from "./SessionsStory.svelte";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { storyBridge } from "./storyBridgeElement";

const meta = {
	title: "Chat/Sessions",
	component: SessionsStory,
	parameters: { layout: "fullscreen" },
	args: { scenario: "history" },
} satisfies Meta<typeof SessionsStory>;
export default meta;
/** 履歴ペインのストーリー定義。 */
type Story = StoryObj<typeof meta>;
/** 削除確認の取消は履歴を閉じず、確定操作だけを Host へ送る。 */
export const History: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		const bridge = storyBridge(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "セッション一覧" }),
		);
		const panel = await canvas.findByRole("complementary", {
			name: "セッション一覧",
		});
		const actions = await within(panel).findAllByRole("button", {
			name: /を削除$/,
		});
		const remove = actions[0];
		if (!remove) {
			throw new globalThis.Error("削除できるセッションがありません");
		}
		await userEvent.click(remove);
		await page.findByRole("alertdialog", {
			name: "セッションを削除しますか？",
		});
		await userEvent.keyboard("{Escape}");
		await waitFor(() =>
			expect(page.queryByRole("alertdialog")).not.toBeInTheDocument(),
		);
		await expect(panel).toBeVisible();
		await expect(remove).toHaveFocus();
		await expect(
			bridge.sent.filter((message) => message.type === "session/delete"),
		).toHaveLength(0);
		await waitFor(() =>
			expect(remove).toHaveStyle({ pointerEvents: "auto" }),
		);
		await userEvent.click(remove);
		const confirmation = await page.findByRole("alertdialog", {
			name: "セッションを削除しますか？",
		});
		await userEvent.click(
			within(confirmation).getByRole("button", {
				name: "セッションを削除",
			}),
		);
		const requests = bridge.sent.filter(
			(message) => message.type === "session/delete",
		);
		await expect(requests).toHaveLength(1);
		await expect(requests[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/);
	},
};
export const Paginated: Story = { args: { scenario: "paginated" } };
export const Empty: Story = { args: { scenario: "empty" } };
export const Error: Story = { args: { scenario: "error" } };
export const Unsupported: Story = { args: { scenario: "unsupported" } };
