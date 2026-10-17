import type { Meta, StoryObj } from "@storybook/svelte-vite";
import SymbolStory from "./SymbolStory.svelte";
import { expect, userEvent, within, waitFor } from "storybook/test";

const meta = {
	title: "Chat/Composer Symbols",
	component: SymbolStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SymbolStory>;

export default meta;

/** 検索から挿入・送信まで操作できるストーリー。 */
type Story = StoryObj<typeof meta>;

export const Search: Story = {
	play: async (context) => openSymbols(context.canvasElement, "UserService"),
};
export const NoResults: Story = {
	play: async (context) =>
		openSymbols(context.canvasElement, "missing-symbol"),
};
export const SearchError: Story = {
	play: async ({ canvasElement }) => {
		await openSymbols(canvasElement, "error");
		await waitFor(() =>
			expect(
				within(canvasElement).getByRole("listbox", {
					name: "シンボル",
				}),
			).toBeVisible(),
		);
	},
};

/** 候補を選択せず、検索結果や Host のエラーをパネル内に残す。 */
async function openSymbols(canvasElement: HTMLElement, query: string) {
	const canvas = within(canvasElement);
	await userEvent.click(
		canvas.getByRole("button", { name: "コンテキストを追加" }),
	);
	await userEvent.click(
		await canvas.findByRole("option", { name: "シンボル" }),
	);
	await userEvent.type(
		canvas.getByRole("combobox", { name: "シンボルを検索" }),
		query,
	);
	await waitFor(() =>
		expect(
			JSON.parse(canvas.getByLabelText("検索完了").textContent),
		).toContain(query),
	);
}
