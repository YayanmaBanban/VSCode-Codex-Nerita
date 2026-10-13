// 元の表示状態と操作アサーションを Svelte UI へ移行する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import ScrollFollowScrollFollowStory from "./ScrollFollowScrollFollowStory.svelte";
import ScrollFollowExample1 from "./ScrollFollowExample1.svelte";

const meta = {
	title: "Chat/Scroll Follow",
	component: ScrollFollowScrollFollowStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ScrollFollowScrollFollowStory>;
export default meta;
type Story = StoryObj<Record<string, never>>;
export const Updates: Story = {};
export const EmptyUpdates: Story = {
	render: () => ({ Component: ScrollFollowExample1 }),
};
export const EmptyConversation: Story = {
	...EmptyUpdates,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const conversation = canvas.getByRole("region", { name: /^会話$/ });
		await userEvent.type(
			canvas.getByRole("textbox"),
			"作業を進めてください。",
		);
		await userEvent.click(canvas.getByRole("button", { name: "送信" }));
		await userEvent.click(
			canvas.getByRole("button", { name: "送信を受け付ける" }),
		);
		await waitFor(() =>
			expect(canvas.getByRole("textbox").textContent).toBe(""),
		);
		const receive = canvas.getByRole("button", { name: "カードを受信" });
		for (let index = 1; index <= 40; index++) {
			await userEvent.click(receive);
			await waitFor(() =>
				expect(
					canvas.getByRole("button", {
						name: `確認結果 ${index} 完了`,
					}),
				).toBeVisible(),
			);
			await waitFor(() =>
				expect(
					conversation.scrollHeight -
						conversation.clientHeight -
						conversation.scrollTop,
				).toBeLessThan(5),
			);
		}
		await expect(conversation.scrollTop).toBeGreaterThan(0);
		await userEvent.click(
			canvas.getByRole("button", { name: "回答を受信" }),
		);
		await waitFor(() =>
			expect(canvas.getByText(/確認が完了しました/)).toBeVisible(),
		);
		await waitFor(() =>
			expect(
				conversation.scrollHeight -
					conversation.clientHeight -
					conversation.scrollTop,
			).toBeLessThan(5),
		);
		await waitFor(() =>
			expect(
				canvas.queryByRole("button", {
					name: "メッセージの末尾へ移動",
				}),
			).not.toBeInTheDocument(),
		);
	},
};
export const LayoutCorrection: Story = {
	...EmptyUpdates,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const conversation = canvas.getByRole("region", { name: /^会話$/ });
		await userEvent.click(
			canvas.getByRole("button", { name: "カードをまとめて受信" }),
		);
		await waitFor(() => expect(conversation.scrollTop).toBeGreaterThan(0));
		await waitFor(() =>
			expect(
				conversation.scrollHeight -
					conversation.clientHeight -
					conversation.scrollTop,
			).toBeLessThan(5),
		);
		await new Promise(requestAnimationFrame);
		await new Promise(requestAnimationFrame);

		const previousHeight = conversation.scrollHeight;
		const previousTop = conversation.scrollTop;
		// 内容の高さが増えたときにスクロール位置を上へずらし、ブラウザや仮想一覧による位置補正を再現する。
		const correction = new Promise<void>((resolve) => {
			const observer = new MutationObserver(() => {
				if (conversation.scrollHeight <= previousHeight) {
					return;
				}
				observer.disconnect();
				conversation.scrollTop = previousTop - 40;
				resolve();
			});
			observer.observe(conversation, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["style"],
			});
		});
		await userEvent.click(
			canvas.getByRole("button", { name: "カードを受信" }),
		);
		await correction;
		await waitFor(() =>
			expect(
				conversation.scrollHeight -
					conversation.clientHeight -
					conversation.scrollTop,
			).toBeLessThan(5),
		);
		await waitFor(() =>
			expect(
				canvas.queryByRole("button", {
					name: "メッセージの末尾へ移動",
				}),
			).not.toBeInTheDocument(),
		);
	},
};
