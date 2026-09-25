// 受付待ち・失敗・再送を同じ入力欄で再現するフォローアップ専用ストーリー。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatApp } from "../../webview/chat/ChatApp";
import { createMockBridge } from "./mocks/mockBridge";
import type { Bridge } from "../../webview/vscodeBridge";

/** 最初の要求だけを失敗させ、入力保持と再送を観察できるようにする。 */
function FollowUpStory({
	failFirst = false,
	completed = false,
}: {
	failFirst?: boolean;
	completed?: boolean;
}) {
	const bridge = useMemo(() => {
		const base = createMockBridge(completed ? "completed" : "streaming");
		let count = 0;
		const timers = new Set<ReturnType<typeof setTimeout>>();
		return {
			subscribe(listener) {
				const unsubscribe = base.subscribe(listener);
				return () => {
					unsubscribe();
					timers.forEach(clearTimeout);
					timers.clear();
				};
			},
			postMessage(message) {
				if (message.type !== "prompt/send") {
					base.postMessage(message);
					return;
				}
				const fail = failFirst && count++ === 0;
				// 待機中の `state` 更新で入力ロックが外れないことも確認する。
				timers.add(
					setTimeout(
						() =>
							base.patchState({
								usage: { used: 100, size: 1000 },
							}),
						100,
					),
				);
				timers.add(
					setTimeout(() => {
						if (fail) {
							base.emit({
								type: "request/failed",
								requestId: message.requestId,
								error: "フォローアップを送信できませんでした。",
							});
						} else {
							base.postMessage(message);
						}
					}, 500),
				);
			},
		} satisfies Bridge;
	}, [failFirst, completed]);
	return <ChatApp bridge={bridge} />;
}
const meta = {
	title: "Chat/FollowUp",
	component: FollowUpStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FollowUpStory>;
export default meta;
/** フォローアップ送信の確認用ストーリー。 */
type Story = StoryObj<typeof meta>;
export const Success: Story = {};
export const Failure: Story = { args: { failFirst: true } };
export const NormalFailure: Story = {
	args: { failFirst: true, completed: true },
};
