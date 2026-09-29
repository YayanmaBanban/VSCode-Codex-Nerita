// セッションチップの保存・復元・送信失敗を実際のチャット UI で確認する。
import { useMemo, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { StoryChat as ChatApp } from "../StoryChat";
import type { Bridge } from "@nerita/shared/bridge";
import { createChatStoryBridge } from "../mocks/mockBridge";

/** 参照元の会話をロードせず、送信される参照 ID だけを観測する。 */
function SessionStory() {
	const [sent, setSent] = useState("");
	const [opened, setOpened] = useState("");
	const [changes, setChanges] = useState("");
	const fail = useRef(false);
	const bridge = useMemo(() => {
		const mock = createChatStoryBridge("empty");

		return {
			...mock,
			subscribe: mock.subscribe,
			postMessage(message) {
				if (message.type === "changes/open") {
					setChanges(message.scope);
					return;
				}
				if (message.type === "session/openReference") {
					setOpened(message.referencedSessionId);
					return;
				}
				if (message.type === "prompt/send") {
					setSent(JSON.stringify(message));
					if (fail.current) {
						fail.current = false;
						mock.emit({
							type: "request/failed",
							requestId: message.requestId,
							error: "参照セッションを読み込めませんでした。参照を外して再送してください。",
						});
						return;
					}
				}
				mock.postMessage(message);
			},
		} satisfies Bridge;
	}, []);
	return (
		<>
			<ChatApp bridge={bridge} />
			<button
				type="button"
				onClick={() => {
					fail.current = true;
				}}
			>
				次の送信を失敗
			</button>
			<output hidden aria-label="送信した参照">
				{sent}
			</output>
			<output hidden aria-label="表示したセッション">
				{opened}
			</output>
			<output hidden aria-label="表示した差分">
				{changes}
			</output>
		</>
	);
}
const meta = {
	title: "Chat/Composer Sessions",
	component: SessionStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SessionStory>;
export default meta;
/** 本文の参照チップを操作するストーリー。 */
type Story = StoryObj<typeof meta>;
export const References: Story = {};
