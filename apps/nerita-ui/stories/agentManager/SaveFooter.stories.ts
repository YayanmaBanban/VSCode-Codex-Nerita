// 一時表示の目視確認には再生操作を用意し、正確な待機時間は仮想時計の検証で確認する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, within } from "storybook/test";
import Preview from "./SaveFooterPreview.svelte";

const meta = {
	title: "Agent Manager/Save Footer",
	component: Preview,
	parameters: {
		layout: "fullscreen",
		docs: {
			description: {
				component:
					"保存済み表示は2秒後に退場します。「保存成功を通知（再生）」で繰り返し確認できます。正確な時間と中間フレームは tests/scratch/agent-manager-footer-review.cjs で検証します。",
			},
		},
	},
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Hidden: Story = {};
export const Unsaved: Story = { args: { initial: "dirty" } };
export const Saved: Story = { args: { initial: "saved" } };
export const Disabled: Story = {
	args: { initial: "dirty", disabled: true },
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).getByRole("button", { name: "変更を保存" }),
		).toBeDisabled();
	},
};
