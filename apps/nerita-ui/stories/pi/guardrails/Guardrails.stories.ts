// 既存の画面状態を Svelte コンポーネントで検証する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import GuardrailsPreview from "./GuardrailsPreview.svelte";
import { expect, userEvent, within } from "storybook/test";

const meta = {
	title: "Pi/Guardrails",
	component: GuardrailsPreview,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof GuardrailsPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Editor: Story = {};
export const Loading: Story = { args: { loading: true } };
export const InvalidJson: Story = {
	args: { invalid: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const alert = await canvas.findByRole("alert");
		await expect(alert).toBeVisible();
		alert.scrollIntoView({ block: "nearest" });
		await expect(
			canvas.getByRole("textbox", { name: "設定JSON" }),
		).toHaveValue("{ invalid JSON");
	},
};
export const SaveError: Story = {
	args: { failure: "save" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "保存" }),
		);
		await expect(await canvas.findByRole("alert")).toBeVisible();
		canvas.getByRole("alert").scrollIntoView({ block: "nearest" });
	},
};
export const InspectionError: Story = {
	args: { failure: "check" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "検査" }),
		);
		await expect(await canvas.findByRole("alert")).toBeVisible();
		canvas.getByRole("alert").scrollIntoView({ block: "nearest" });
	},
};
export const EditConflict: Story = {
	args: { failure: "edit" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("switch", { name: "JSONで編集" }),
		);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "設定JSON" }),
			" ",
		);
		await expect(await canvas.findByRole("alert")).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "編集を破棄して再読込" }),
		).toBeEnabled();
		canvas
			.getByRole("button", { name: "編集を破棄して再読込" })
			.scrollIntoView({ block: "nearest" });
		canvas.getByRole("alert").scrollIntoView({ block: "nearest" });
	},
};
export const InspectionResult: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			await within(canvasElement).findByRole("button", { name: "検査" }),
		);
	},
};
