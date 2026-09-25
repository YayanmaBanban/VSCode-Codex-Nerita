// 大文字・単語境界・コード・インライン装飾を含む会話内検索用の表示を作る。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatApp } from "../../webview/chat/ChatApp";
import { createMockBridge } from "./mocks/mockBridge";

/** 実コンポーネントに検索条件を比較しやすい固定の会話を渡す。 */
function SearchStory() {
	const bridge = useMemo(() => {
		const mock = createMockBridge("empty");
		mock.patchState({
			messages: [
				{
					id: "search-user",
					role: "user",
					text: "Power power powerful power_1",
				},
				{
					id: "search-assistant",
					role: "assistant",
					text: [
						"power **station** POWER",
						"猫 猫舌 子猫",
						...Array.from(
							{ length: 15 },
							(_, index) =>
								`補足 ${index + 1}: 検索位置へスクロールできる長い会話です。`,
						),
						"```text\npower[1] power(2)\n```",
					].join("\n\n"),
				},
			],
		});
		return mock;
	}, []);
	return <ChatApp bridge={bridge} />;
}

const meta = {
	title: "Chat/Search",
	component: SearchStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SearchStory>;
export default meta;
/** 検索条件とキーボード操作を確認するストーリー。 */
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
