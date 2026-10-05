// 性格設定の固定 DTO を実チャットへ注入し、保存処理は送信記録だけで観測する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { StoryChat as ChatApp, storyBridge } from "./StoryChat";
import { expect, userEvent, within } from "storybook/test";
import { createChatStoryBridge } from "./mocks/mockBridge";
import type { PersonalitySettings } from "@nerita/shared/personality";

/** 設定の読取りには固定応答を返し、保存や選択から成功状態を計算しない。 */
function PersonalityStory({ configured = false }: { configured?: boolean }) {
	const bridge = useMemo(() => {
		const mock = createChatStoryBridge();
		const settings: PersonalitySettings = {
			global: {
				presets: [
					{ name: "簡潔", text: "日本語で簡潔に回答する。" },
					{ name: "レビュー", text: "判断理由を具体的に説明する。" },
				],
				selected: "簡潔",
				configuredText: configured
					? "日本語で回答する。\n技術的な判断理由を省略しない。"
					: null,
			},
			workspace: {
				presets: [],
				selected: "",
				configuredText: configured
					? "このプロジェクトでは既存設計を優先する。"
					: null,
			},
		};
		return {
			...mock,
			postMessage(message: Parameters<typeof mock.postMessage>[0]) {
				mock.postMessage(message);
				if (message.type === "personality/read") {
					mock.patchState({ personality: settings });
				}
			},
		};
	}, [configured]);
	return <ChatApp bridge={bridge} />;
}

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
		await userEvent.click(
			global.getByRole("button", { name: "保存" }),
		);
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
