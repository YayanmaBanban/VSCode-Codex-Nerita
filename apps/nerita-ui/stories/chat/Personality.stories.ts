import type { Meta, StoryObj } from "@storybook/svelte-vite";
import PersonalityStory from "./PersonalityStory.svelte";
import { storyBridge } from "./storyBridgeElement";
import { expect, userEvent, within } from "storybook/test";

const meta = {
	title: "Chat/Personality",
	component: PersonalityStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PersonalityStory>;

export default meta;

/** 編集可能と固定設定の表示開始状態。 */
type Story = StoryObj<typeof meta>;

export const Editable: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const body = within(canvasElement.ownerDocument.body);
		const bridge = storyBridge(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "オプション" }),
		);
		await userEvent.click(
			await body.findByRole("menuitem", { name: "性格設定" }),
		);
		const dialog = within(
			await body.findByRole("dialog", { name: "性格設定" }),
		);
		const global = within(
			dialog.getByRole("region", { name: "グローバル" }),
		);
		const name = global.getByRole("textbox", {
			name: "グローバルのプリセット名",
		});
		await userEvent.clear(name);
		await userEvent.type(name, "新しい名前");
		await userEvent.click(global.getByRole("button", { name: "保存" }));
		const saves = bridge.sent.filter(
			(message) => message.type === "personality/save",
		);
		await expect(saves).toHaveLength(1);
		await expect(saves[0]).toMatchObject({
			type: "personality/save",
			scope: "global",
			name: "新しい名前",
			originalName: "簡潔",
			text: "日本語で簡潔に回答する。",
		});
		await expect(name).toBeDisabled();
	},
};

export const Configured: Story = { args: { configured: true } };
