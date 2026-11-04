// 通知の色指定と時間経過をチャットの実行状態から独立して確認する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import NotificationStory from "./NotificationStory.svelte";
import "../../src/chat/chat.css";

const meta = {
	title: "Chat/NotificationCard",
	component: NotificationStory,
	parameters: { layout: "fullscreen" },
	args: { duration: 60_000 },
	argTypes: {
		duration: {
			control: { type: "number", min: 100, step: 100 },
			description:
				"表示時間（ミリ秒）。見本は60秒、自動消去の検証は本体と同じ2秒。",
		},
	},
} satisfies Meta<typeof NotificationStory>;
export default meta;
/** 標準色と任意の背景色を比較するストーリー。 */
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const CustomBackground: Story = { args: { backgroundColor: "#28483a" } };

export const DismissAndReplay: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("status")).toBeVisible();
		await userEvent.click(
			canvas.getByRole("button", { name: "通知を閉じる" }),
		);
		await expect(canvas.queryByRole("status")).not.toBeInTheDocument();
		await userEvent.click(
			canvas.getByRole("button", { name: "通知を再生" }),
		);
		await expect(canvas.getByRole("status")).toBeVisible();
	},
};

export const AutoDismiss: Story = {
	args: { duration: 2000 },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("status")).toBeVisible();
		await waitFor(
			() => expect(canvas.queryByRole("status")).not.toBeInTheDocument(),
			{ timeout: 3500 },
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "通知を再生" }),
		);
		await expect(canvas.getByRole("status")).toBeVisible();
	},
};
