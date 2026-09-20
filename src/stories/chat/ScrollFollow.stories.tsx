// 本体の会話画面へ手動で更新を送り、閲覧位置と末尾追従を再現する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { initialState, type ChatState } from "../../shared/chatState";
import type { HostMessage } from "../../shared/messages";
import { ChatApp } from "../../webview/chat/ChatApp";
import type { Bridge } from "../../webview/vscodeBridge";

function ScrollFollowStory() {
	const control = useMemo(() => {
		let state: ChatState = {
			...initialState(),
			connection: "ready",
			sessionId: "scroll",
			messages: [
				{
					id: "answer",
					role: "assistant",
					text: "段落の本文です。\n\n".repeat(40),
				},
			],
		};
		const listeners = new Set<(message: HostMessage) => void>();
		const emit = () =>
			listeners.forEach((listener) =>
				listener({ type: "state/snapshot", state }),
			);
		const bridge: Bridge = {
			subscribe(listener) {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
			postMessage(message) {
				if (message.type === "ui/ready") {
					emit();
				}
			},
		};
		return {
			bridge,
			append() {
				state = {
					...state,
					revision: state.revision + 1,
					messages: state.messages.map((message) => ({
						...message,
						text: message.text + "追記した本文です。\n\n".repeat(8),
					})),
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
								"**高さが変わるツール本文**\n\n".repeat(20),
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
	}, []);
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
const meta = {
	title: "Chat/Scroll Follow",
	component: ScrollFollowStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ScrollFollowStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Updates: Story = {};
