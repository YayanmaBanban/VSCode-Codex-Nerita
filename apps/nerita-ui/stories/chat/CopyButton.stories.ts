// コピー結果は800 ms だけ表示される。中間状態の撮影は仮想時計で行う。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, spyOn, userEvent, within } from "storybook/test";
import CopyButton from "../../src/chat/CopyButton.svelte";

const meta = {
	title: "Chat/Copy Feedback",
	component: CopyButton,
	args: {
		text: "コピーする本文",
		label: "本文をコピー",
		className: "size-8",
	},
} satisfies Meta<typeof CopyButton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Success: Story = {
	play: async (context) => copyResult(context.canvasElement, false),
};
export const Failure: Story = {
	play: async (context) => copyResult(context.canvasElement, true),
};

/** 外部のクリップボード応答だけを代替し、実ボタンの一時表示を確認する。 */
async function copyResult(canvasElement: HTMLElement, fail: boolean) {
	const copy = spyOn(navigator.clipboard, "writeText");
	if (fail) {
		copy.mockRejectedValue(new Error("clipboard unavailable"));
	} else {
		copy.mockResolvedValue(undefined);
	}
	try {
		const button = within(canvasElement).getByRole("button", {
			name: "本文をコピー",
		});
		await userEvent.click(button);
		await expect(button).toHaveAttribute(
			"data-copy-result",
			fail ? "error" : "success",
		);
	} finally {
		copy.mockRestore();
	}
}
