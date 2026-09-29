// ツールを挟む会話と次の送信後の履歴を実画面で確認する。
import { timelineMessages } from "./fixtures/timeline";
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { StoryChat as ChatApp } from "./StoryChat";
import { createChatStoryBridge } from "./mocks/mockBridge";

/** 受信順を持つ完了済み会話を作る。 */
function TimelineStory() {
	const bridge = useMemo(() => {
		const bridge = createChatStoryBridge();
		bridge.patchState({
			run: "completed",
			runId: "previous",
			messages: timelineMessages(),
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
