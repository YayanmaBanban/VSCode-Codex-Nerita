// 既存の画面状態を Svelte コンポーネントで検証する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, within } from "storybook/test";
import SandboxPreview from "./SandboxPreview.svelte";
const meta = { title: "Pi/Sandbox", component: SandboxPreview } satisfies Meta<
	typeof SandboxPreview
>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByText("host · このワークスペース"),
		).toBeVisible();
		await expect(canvas.getByText("helper · node · read")).toBeVisible();
		await expect(canvas.getByText("install · node · read")).toBeVisible();
		await expect(
			canvas.getByText("pnpm · Sandbox キャッシュ"),
		).toBeVisible();
	},
};
export const Unavailable: Story = { args: { unavailable: true } };
