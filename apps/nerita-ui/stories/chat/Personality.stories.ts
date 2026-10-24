import type { Meta, StoryObj } from "@storybook/svelte-vite";
import PersonalityStory from "./PersonalityStory.svelte";
import { storyBridge } from "./storyBridgeElement";
import { expect, userEvent, within, waitFor } from "storybook/test";

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

export const Configured: Story = {
	args: { configured: true },
	play: async (context) => {
		await openPersonality(context);
		const page = within(context.canvasElement.ownerDocument.body);
		await expect(
			page.getByRole("button", { name: "性格設定を閉じる" }),
		).toHaveFocus();
		await waitFor(() =>
			expect(page.queryByRole("tooltip")).not.toBeInTheDocument(),
		);
	},
};
export const Help: Story = {
	args: { configured: true },
	play: async (context) => {
		await openPersonality(context);
		const page = within(context.canvasElement.ownerDocument.body);
		await userEvent.hover(
			page.getByRole("button", { name: "指示の使い分け" }),
		);
		await waitFor(() => expect(page.getByRole("tooltip")).toBeVisible());
	},
};
export const Loading: Story = {
	args: { pending: true },
	play: openPersonality,
};
export const LoadError: Story = {
	args: { failure: true },
	play: async (context) => {
		await openPersonality(context);
		await expect(
			await within(
				within(context.canvasElement.ownerDocument.body).getByRole(
					"dialog",
					{ name: "性格設定" },
				),
			).findByRole("alert"),
		).toBeVisible();
	},
};
export const NameCollision: Story = {
	play: async (context) => {
		await openPersonality(context);
		const dialog = within(context.canvasElement.ownerDocument.body);
		const input = dialog.getByRole("textbox", {
			name: "グローバルのプリセット名",
		});
		await userEvent.clear(input);
		await userEvent.type(input, "レビュー");
		await expect(dialog.getByRole("alert")).toBeVisible();
		await expect(
			within(
				dialog.getByRole("region", { name: "グローバル" }),
			).getByRole("button", { name: "保存" }),
		).toBeDisabled();
	},
};

/** 確認対象の設定パネルを開いた状態で操作を終える。 */
async function openPersonality({
	canvasElement,
}: {
	canvasElement: HTMLElement;
}) {
	const trigger = within(canvasElement).getByRole("button", {
		name: "オプション",
	});
	await waitFor(() =>
		expect(globalThis.getComputedStyle(trigger).pointerEvents).not.toBe(
			"none",
		),
	);
	await userEvent.click(trigger);
	const body = within(canvasElement.ownerDocument.body);
	await userEvent.click(
		await body.findByRole("menuitem", { name: "性格設定" }),
	);
	await expect(
		await body.findByRole("dialog", { name: "性格設定" }),
	).toBeVisible();
}
