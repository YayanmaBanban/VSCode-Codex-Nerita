// 実際のチャット上でタイトル・接続遷移・表示先メッセージを再現する。
import HeaderStory from "./HeaderStory.svelte";
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { storyBridge } from "../storyBridgeElement";
import { expect, userEvent, within, waitFor } from "storybook/test";

const meta = {
	title: "Chat/Header",
	component: HeaderStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof HeaderStory>;
export default meta;
/** ヘッダーの観察開始状態。 */
type Story = StoryObj<typeof meta>;
export const Untitled: Story = {};
export const LongTitle: Story = {
	args: {
		title: "セッションのタイトルを表示して、長い場合もアイコン操作が見切れないことを確認する",
	},
};
export const Reconnect: Story = {
	args: { error: true, title: "接続の復旧を確認する" },
};
export const PiBackend: Story = {
	args: { backend: "pi" },
};
export const UntrustedWorkspace: Story = {
	args: { backend: "pi", untrusted: true },
};
/** クリックだけでは信頼済みにせず、Host の通知で表示を切り替える。 */
export const TrustTransition: Story = {
	args: { backend: "pi", untrusted: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = storyBridge(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "信頼する" }));
		const requests = bridge.sent.filter(
			(message) => message.type === "workspace/manageTrust",
		);
		await expect(requests).toHaveLength(1);
		await expect(requests[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/);
		await waitFor(() =>
			expect(
				canvas.getByRole("region", { name: "ワークスペースの信頼" }),
			).toBeVisible(),
		);
		bridge.emit({ type: "workspace/trustState", untrusted: false });
		await waitFor(() =>
			expect(
				canvas.queryByRole("region", { name: "ワークスペースの信頼" }),
			).not.toBeInTheDocument(),
		);
		bridge.emit({ type: "workspace/trustState", untrusted: true });
		await waitFor(() =>
			expect(
				canvas.getByRole("region", { name: "ワークスペースの信頼" }),
			).toBeVisible(),
		);
		bridge.emit({ type: "ui/backendState", backend: "codex" });
		await waitFor(() =>
			expect(
				canvas.queryByRole("region", { name: "ワークスペースの信頼" }),
			).not.toBeInTheDocument(),
		);
	},
};
export const AuthenticationFailure: Story = {
	args: { authFailure: true },
};
export const AuthenticationSuccess: Story = {
	args: { authSuccess: true },
};

/** 連続した状態変更と待機中の演出を確認する。 */
export const Transitions: Story = { args: { transitions: true } };
