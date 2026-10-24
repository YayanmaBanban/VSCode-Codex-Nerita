// 共通数値入力の範囲・刻み・空欄・キーボード操作を確認し、エラーの状態は画面に残す。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import Preview from "./NumericFieldPreview.svelte";

const meta = {
	title: "UI/Numeric Field",
	component: Preview,
	parameters: { layout: "fullscreen" },
	args: {
		label: "タイムアウト",
		unit: "秒",
		min: 1,
		max: 600,
		step: 1,
		initial: 120,
	},
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;
const tooltip = "数値入力の補足説明です。";
export const Default: Story = {
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).queryByRole("button"),
		).not.toBeInTheDocument();
	},
};
export const WithTooltip: Story = {
	args: { tooltip },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		const input = canvas.getByRole("spinbutton");
		const help = canvas.getByRole("button");
		await expect(input).toHaveAccessibleDescription(tooltip);
		await expect(page.queryByRole("tooltip")).not.toBeInTheDocument();
		await userEvent.tab();
		await expect(help).toHaveFocus();
		await expect(await page.findByRole("tooltip")).toHaveTextContent(
			tooltip,
		);
		await userEvent.keyboard("{Escape}");
		await waitFor(() =>
			expect(page.queryByRole("tooltip")).not.toBeInTheDocument(),
		);
		await userEvent.tab();
		await expect(input).toHaveFocus();
		await userEvent.hover(help);
		await expect(await page.findByRole("tooltip")).toHaveTextContent(
			tooltip,
		);
		await expect(input).toHaveValue(meta.args.initial);
	},
};
export const DisabledWithTooltip: Story = {
	args: { disabled: true, tooltip },
};
export const OutOfRange: Story = {
	args: { initial: 601 },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"タイムアウトは1〜600秒の範囲で入力してください。",
		);
		await expect(canvas.getByRole("spinbutton")).toHaveAttribute(
			"aria-invalid",
			"true",
		);
	},
};
export const DecimalInIntegerField: Story = {
	args: { initial: 1.5 },
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).getByRole("alert"),
		).toHaveTextContent("タイムアウトは整数で入力してください。");
	},
};
export const Empty: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.clear(canvas.getByRole("spinbutton"));
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"タイムアウトが空欄です。数値を入力してください。",
		);
	},
};
export const Disabled: Story = {
	args: { disabled: true },
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).getByRole("spinbutton"),
		).toBeDisabled();
	},
};
export const Keyboard: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const input = canvas.getByRole("spinbutton");
		await userEvent.click(input);
		await userEvent.keyboard("{ArrowUp}{ArrowUp}{ArrowDown}");
		await expect(input).toHaveValue(121);
		await userEvent.clear(input);
		await userEvent.type(input, "1");
		await userEvent.keyboard("{ArrowDown}");
		await expect(input).toHaveValue(1);
		await userEvent.clear(input);
		await userEvent.type(input, "600");
		await userEvent.keyboard("{ArrowUp}");
		await expect(input).toHaveValue(600);
		await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
	},
};
export const FractionalStep: Story = {
	args: { label: "倍率", unit: "", min: 0, max: 2, step: 0.25, initial: 0.5 },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const input = canvas.getByRole("spinbutton");
		await userEvent.click(input);
		await userEvent.keyboard("{ArrowUp}");
		await expect(input).toHaveValue(0.75);
	},
};
