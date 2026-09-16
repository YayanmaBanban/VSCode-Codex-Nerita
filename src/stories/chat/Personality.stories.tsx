// 性格設定の編集とconfig.tomlによる固定を実チャット内で再現する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatApp } from "../../webview/chat/ChatApp";
import { createMockBridge } from "./mocks/mockBridge";
import type { PersonalitySettings } from "../../shared/personality";
/** 保存と選択の応答を返す性格設定専用Story。 */
function PersonalityStory({ configured = false }: { configured?: boolean }) {
	const bridge = useMemo(() => {
		const mock = createMockBridge();
		let settings: PersonalitySettings = {
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
			subscribe: mock.subscribe,
			postMessage: (message: Parameters<typeof mock.postMessage>[0]) => {
				if (message.type === "personality/read") {
					mock.patchState({ personality: structuredClone(settings) });
					return;
				}
				if (
					message.type === "personality/save" ||
					message.type === "personality/select"
				) {
					settings = structuredClone(settings);
					const scope = settings[message.scope];
					if (message.type === "personality/save") {
						const existing = scope.presets.find(
							(p) => p.name === message.name,
						);
						if (existing) {
							existing.text = message.text;
						} else {
							scope.presets.push({
								name: message.name,
								text: message.text,
							});
						}
					}
					scope.selected = message.name;
					mock.patchState({ personality: settings });
					return;
				}
				mock.postMessage(message);
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
/** 編集可能・固定の観察開始状態。 */
type Story = StoryObj<typeof meta>;
export const Editable: Story = {};
export const Configured: Story = { args: { configured: true } };
