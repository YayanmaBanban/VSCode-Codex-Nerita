// ツールを挟む会話と次の送信後の履歴を実画面で確認する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatApp } from "./ChatApp";
import { createMockBridge } from "./mockBridge";

/** 受信順を持つ完了済み会話を作る。 */
function TimelineStory() {
	const bridge = useMemo(() => {
		const bridge = createMockBridge();
		bridge.patchState({
			run: "completed",
			runId: "previous",
			messages: [
				{
					id: "user",
					role: "user",
					text: "テストしてください",
					order: 1,
				},
				{
					id: "before",
					role: "assistant",
					text: "テストを実行します。",
					order: 2,
				},
				{
					id: "after",
					role: "assistant",
					text: "テストが成功しました。",
					order: 4,
				},
			],
			tools: [
				{
					id: "cmd",
					runId: "previous",
					order: 3,
					kind: "execute",
					title: "pnpm.cmd test",
					status: "completed",
					paths: [],
					rawInput: {
						cwd: "D:/workspace/project",
						command: "pnpm.cmd test",
					},
					rawOutput: { formatted_output: "✓ All tests passed" },
				},
			],
		});
		return bridge;
	}, []);
	return <ChatApp bridge={bridge} />;
}
const meta = {
	title: "Chat/Timeline",
	component: TimelineStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TimelineStory>;
export default meta;
/** 会話中の実行カードを表示する。 */
type Story = StoryObj<typeof meta>;
export const History: Story = {};
