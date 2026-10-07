// 本体の会話画面へ手動で更新を送り、閲覧位置と末尾追従を再現する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { initialState, type ChatState } from "@nerita/shared/chatState";
import { textToolContent } from "@nerita/shared/toolContent";
import { createStoryBridge } from "./mocks/storyBridge";
import { StoryChat as ChatApp } from "./StoryChat";

function ScrollFollowStory() {
	const control = useMemo(createScrollControl, []);
	return (
		<>
			<div className="fixed top-0 right-0 z-50">
				<button onClick={() => control.append()}>本文を追記</button>
				<button onClick={() => control.tool()}>ツールを追加</button>
				<button onClick={() => control.reset()}>会話を切替</button>
			</div>
			<ChatApp bridge={control.bridge} />
		</>
	);
}

/** 本文の追記と会話切替を、Host からの状態通知として再現する。 */
function createScrollControl() {
	let state: ChatState = {
		...initialState(),
		connection: "ready",
		sessionId: "scroll",
		messages: [
			{
				id: "user",
				role: "user",
				text: "添付ファイルを確認してください。",
				attachments: [
					{
						id: "file",
						name: "育成素材と必要数量の一覧をまとめた長いファイル名.txt",
						uri: "file:///workspace/materials.txt",
					},
				],
			},
			{
				id: "answer",
				role: "assistant",
				text: "段落の本文です。\n\n".repeat(40),
			},
		],
	};
	const bridge = createStoryBridge(state);
	const emit = () => bridge.emit({ type: "state/snapshot", state });
	return {
		bridge,
		append() {
			state = {
				...state,
				revision: state.revision + 1,
				messages: state.messages.map((message) =>
					message.role === "assistant"
						? {
								...message,
								text:
									message.text +
									"追記した本文です。\n\n".repeat(8),
							}
						: message,
				),
			};
			emit();
		},
		tool() {
			state = {
				...state,
				revision: state.revision + 1,
				tools: [
					{
						id: "reason",
						kind: "think",
						title: "推論",
						status: "in_progress",
						paths: [],
						content: [
							textToolContent(
								"**高さが変わるツール本文**\n\n".repeat(20),
							),
						],
					},
				],
			};
			emit();
		},
		reset() {
			state = {
				...state,
				revision: state.revision + 1,
				sessionId: `${state.revision}`,
				tools: [],
			};
			emit();
		},
	};
}
const meta = {
	title: "Chat/Scroll Follow",
	component: ScrollFollowStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ScrollFollowStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Updates: Story = {};
