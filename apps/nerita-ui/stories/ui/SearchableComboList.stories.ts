// 多数の候補の検索と、選択・無効状態・再表示時の動作を利用側と同じ部品で確認する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import Preview from "./SearchableComboListPreview.svelte";

const meta = {
	title: "UI/SearchableComboList",
	component: Preview,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Editor: Story = {};
export const FourOptions: Story = {
	args: { count: 4 },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const trigger = canvas.getByRole("combobox", { name: "候補" });
		await userEvent.click(trigger);
		const panel = within(
			await within(canvasElement.ownerDocument.body).findByRole("dialog"),
		);
		await expect(panel.queryByRole("searchbox")).not.toBeInTheDocument();
		await waitFor(() =>
			expect(
				panel.getByRole("option", { name: "Item 001" }),
			).toHaveFocus(),
		);
		await userEvent.keyboard("{ArrowDown}{Enter}");
		await expect(trigger).toHaveTextContent("Item 003");
		await userEvent.click(trigger);
		await waitFor(() =>
			expect(
				within(canvasElement.ownerDocument.body).getByRole("option", {
					name: "Item 003",
				}),
			).toHaveFocus(),
		);
		await userEvent.keyboard("{Escape}");
	},
};
export const FiveOptions: Story = {
	args: { count: 5 },
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("combobox", { name: "候補" }),
		);
		const panel = within(
			await within(canvasElement.ownerDocument.body).findByRole("dialog"),
		);
		const search = panel.getByRole("searchbox");
		await waitFor(() => expect(search).toHaveFocus());
		await userEvent.type(search, "Item 005");
		await expect(panel.getAllByRole("option")).toHaveLength(1);
		await expect(search).toBeVisible();
	},
};
export const NoMatches: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("combobox", { name: "候補" }));
		const panel = within(
			await within(canvasElement.ownerDocument.body).findByRole(
				"dialog",
				{ name: "候補を検索" },
			),
		);
		await userEvent.type(panel.getByRole("searchbox"), "unmatched-query");
		await expect(panel.queryAllByRole("option")).toHaveLength(0);
		await userEvent.keyboard("{Enter}");
		await expect(canvas.getByLabelText("選択値")).toHaveTextContent(
			"item-001",
		);
	},
};
export const ManyOptions: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		const trigger = canvas.getByRole("combobox", { name: "候補" });
		trigger.focus();
		await userEvent.keyboard("{ArrowDown}");
		const panel = within(
			await page.findByRole("dialog", { name: "候補を検索" }),
		);
		const search = panel.getByRole("searchbox", { name: "候補を検索" });
		await waitFor(() => expect(search).toHaveFocus());
		await expect(panel.getAllByRole("option")).toHaveLength(120);
		await userEvent.type(search, "候補の説明 120");
		await expect(panel.getAllByRole("option")).toHaveLength(1);
		await userEvent.keyboard("{Enter}");
		await expect(canvas.getByLabelText("選択値")).toHaveTextContent(
			"item-120",
		);
		await expect(trigger).toHaveTextContent("Item 120");
		await userEvent.click(trigger);
		const reopened = within(
			await page.findByRole("dialog", { name: "候補を検索" }),
		);
		await expect(reopened.getByRole("searchbox")).toHaveValue("");
		await expect(
			reopened.getByRole("option", { name: "Item 120" }),
		).toHaveAttribute("aria-selected", "true");
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(trigger).toHaveFocus());
	},
};
export const KeyboardSkipsDisabled: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("combobox", { name: "候補" }));
		const panel = within(
			await within(canvasElement.ownerDocument.body).findByRole(
				"dialog",
				{ name: "候補を検索" },
			),
		);
		await waitFor(() => expect(panel.getByRole("searchbox")).toHaveFocus());
		await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
		await expect(canvas.getByLabelText("選択値")).toHaveTextContent(
			"item-003",
		);
	},
};
export const Disabled: Story = {
	args: { disabled: true },
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).getByRole("combobox", { name: "候補" }),
		).toBeDisabled();
	},
};
export const Empty: Story = { args: { empty: true } };
export const SearchIcon: Story = { args: { appearance: "icon" } };
