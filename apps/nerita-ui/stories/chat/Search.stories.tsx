// 大文字・単語境界・コード・インライン装飾を含む会話内検索用の表示を作る。
import { searchMessages } from "./fixtures/search";
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { StoryChat as ChatApp } from "./StoryChat";
import { createChatStoryBridge } from "./mocks/mockBridge";

/** 実コンポーネントに検索条件を比較しやすい固定の会話を渡す。 */
function SearchStory() {
	const bridge = useMemo(() => {
		const mock = createChatStoryBridge("empty");
		mock.patchState({
			messages: searchMessages(),
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
