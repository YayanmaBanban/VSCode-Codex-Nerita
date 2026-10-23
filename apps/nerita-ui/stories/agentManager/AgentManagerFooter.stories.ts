// 一時表示の目視確認には再生操作を用意し、正確な待機時間は仮想時計の検証で確認する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, fn, userEvent, within, waitFor } from "storybook/test";
import Preview from "./AgentManagerFooterPreview.svelte";

const meta = {
	title: "Agent Manager/Footer",
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

const reloadError =
	"Error: 設定が変更されています。再読み込みしてから保存してください。";
export const ReloadError: Story = {
	args: { initial: "dirty", error: reloadError, onReload: fn() },
	play: async ({ canvasElement, args }) => {
		const footer = within(canvasElement.querySelector("footer")!);
		await expect(footer.getByRole("alert")).toHaveTextContent(
			reloadError.slice(7),
		);
		await expect(footer.getAllByRole("button")).toHaveLength(1);
		await expect(
			canvasElement.querySelector("footer .lucide-circle-alert"),
		).toBeInTheDocument();
		await userEvent.click(
			footer.getByRole("button", { name: "再読み込み" }),
		);
		await expect(args.onReload).toHaveBeenCalledOnce();
	},
};
export const ErrorWithoutReload: Story = {
	args: { error: "Error: 同名の Agent が存在します。" },
	play: async ({ canvasElement }) => {
		const footer = within(canvasElement.querySelector("footer")!);
		await waitFor(() => expect(footer.getByRole("alert")).toBeVisible());
		await expect(
			footer.queryByRole("button", { name: "再読み込み" }),
		).not.toBeInTheDocument();
	},
};
