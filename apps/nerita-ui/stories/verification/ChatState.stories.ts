// 通信の逆転・欠落・解除後の応答を、本体と同じ状態更新で確認する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import ChatStateProbe from "./ChatStateProbe.svelte";

const meta = {
	title: "Verification/Chat state lifecycle",
	component: ChatStateProbe,
} satisfies Meta<typeof ChatStateProbe>;
export default meta;
type Story = StoryObj<typeof meta>;

export const RevisionAndConnection: Story = {
	/** 初回の状態を戻さず、差分欠落では再取得し、解除済み接続の応答を拒否する。 */
	async play({ canvasElement }) {
		const canvas = within(canvasElement);
		await waitFor(() =>
			expect(canvas.getByTestId("session")).toHaveTextContent(/^first$/),
		);
		await expect(canvas.getByTestId("subscriptions")).toHaveTextContent(
			/^1$/,
		);
		await expect(canvas.getByTestId("ready")).toHaveTextContent(/^1$/);
		await userEvent.click(canvas.getByRole("button", { name: "古い状態" }));
		await expect(canvas.getByTestId("revision")).toHaveTextContent(/^10$/);
		await expect(canvas.getByTestId("session")).toHaveTextContent(
			/^first$/,
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "欠けた差分" }),
		);
		await expect(canvas.getByTestId("ready")).toHaveTextContent(/^2$/);
		await expect(canvas.getByTestId("revision")).toHaveTextContent(/^10$/);
		await userEvent.click(
			canvas.getByRole("button", { name: "正しい差分" }),
		);
		await expect(canvas.getByTestId("session")).toHaveTextContent(
			/^valid$/,
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "接続を変更" }),
		);
		await waitFor(() =>
			expect(canvas.getByTestId("session")).toHaveTextContent(/^second$/),
		);
		await expect(canvas.getByTestId("subscriptions")).toHaveTextContent(
			/^0$/,
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "前の接続の遅延応答" }),
		);
		await expect(canvas.getByTestId("session")).toHaveTextContent(
			/^second$/,
		);
		await expect(canvas.getByTestId("revision")).toHaveTextContent(/^20$/);
	},
};
