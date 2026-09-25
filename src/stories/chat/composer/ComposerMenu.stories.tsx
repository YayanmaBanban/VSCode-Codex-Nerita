// 添付とスキルを持つチャットで、候補選択と送信する本文を確認する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatApp } from "../../../webview/chat/ChatApp";
import { createMockBridge } from "../mocks/mockBridge";

/** 実接続を使わず、Host が渡す一覧を再現する。 */
function ComposerMenuStory() {
	const bridge = useMemo(() => {
		const mock = createMockBridge("empty");
		mock.patchState({
			attachments: [
				{
					id: "a",
					name: "alpha.ts",
					uri: "file:///D:/workspace/alpha.ts",
				},
				{
					id: "b",
					name: "日本語 sample.md",
					uri: "file:///D:/workspace/sample.md",
				},
			],
			skills: [
				{
					name: "review",
					description: "コードを確認する",
					path: "D:/skills/review/SKILL.md",
				},
				{
					name: "test",
					description: "テストを実行する",
					path: "D:/skills/test/SKILL.md",
				},
			],
		});
		return mock;
	}, []);
	return <ChatApp bridge={bridge} />;
}
const meta = {
	title: "Chat/Composer Menu",
	component: ComposerMenuStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ComposerMenuStory>;
export default meta;
/** 入力候補を操作できるストーリー。 */
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
