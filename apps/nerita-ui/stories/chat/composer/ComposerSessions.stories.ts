import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import SessionStory from "./SessionStory.svelte";
import { storyBridge } from "../storyBridgeElement";

const meta = {
	title: "Chat/Composer Sessions",
	component: SessionStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SessionStory>;

export default meta;

/** 本文の参照チップを操作するストーリー。 */
type Story = StoryObj<typeof meta>;

export const References: Story = {};

/** 検索語を戻した時に、以前の次ページのカーソルを持ち越さない。 */
export const PaginationQueryReset: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = storyBridge(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "コンテキストを追加" }),
		);
		await userEvent.click(
			await canvas.findByRole("option", { name: "セッション" }),
		);
		const search = canvas.getByRole("combobox", {
			name: "セッションを検索",
		});
		const more = await canvas.findByRole("option", {
			name: "さらに読み込む",
		});
		await userEvent.click(more);
		await expect(
			await canvas.findByRole("option", {
				name: /入力欄の実装とセッション参照の確認/,
			}),
		).toBeVisible();
		await expect(bridge.sent).toContainEqual(
			expect.objectContaining({
				type: "session/searchReferences",
				query: "",
				cursor: "second",
			}),
		);

		await userEvent.type(search, "入力欄");
		await waitFor(() =>
			expect(
				canvas.queryByRole("option", { name: "さらに読み込む" }),
			).not.toBeInTheDocument(),
		);
		await userEvent.clear(search);
		await expect(
			await canvas.findByRole("option", { name: "さらに読み込む" }),
		).toBeVisible();
		await waitFor(async () => {
			const requests = bridge.sent.filter(
				(message) => message.type === "session/searchReferences",
			);
			await expect(requests.at(-1)).toEqual(
				expect.objectContaining({ query: "" }),
			);
			await expect(requests.at(-1)?.cursor).toBeUndefined();
		});
	},
};
