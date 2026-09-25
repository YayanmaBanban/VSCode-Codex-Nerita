// コード本文の照合応答と、URI・範囲だけの送信を観察する。
import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Bridge } from "../../../webview/vscodeBridge";
import { ChatApp } from "../../../webview/chat/ChatApp";
import { createMockBridge } from "../mocks/mockBridge";

/** コピー通知は Host のテストで検証し、ここでは照合済み応答を再現する。 */
function CopiedCodeStory() {
	const [opened, setOpened] = useState("");
	const [sent, setSent] = useState("");
	const [resolved, setResolved] = useState(0);
	const bridge = useMemo(() => {
		const mock = createMockBridge("empty");
		return {
			subscribe: mock.subscribe,
			postMessage(message) {
				if (message.type === "workspace/resolveCode") {
					setTimeout(() => {
						mock.emit({
							type: "workspace/resolvedPath",
							requestId: message.requestId,
							entry: message.text.startsWith("let controller:")
								? {
										uri: "file:///D:/workspace/project/src/extension.ts",
										path: "D:\\workspace\\project\\src\\extension.ts",
										name: "extension.ts",
										kind: "file",
										range: {
											start: {
												line: 8,
												character: 0,
											},
											end: {
												line: 11,
												character: 40,
											},
										},
									}
								: null,
						});
						setResolved((previous) => previous + 1);
					}, 100);
					return;
				}
				if (message.type === "reference/open") {
					setOpened(JSON.stringify(message));
					return;
				}
				if (message.type === "prompt/send") {
					setSent(JSON.stringify(message));
				}
				mock.postMessage(message);
			},
		} satisfies Bridge;
	}, []);
	return (
		<>
			<ChatApp bridge={bridge} />
			<output hidden aria-label="照合完了数">
				{resolved}
			</output>
			<output hidden aria-label="開いたコード">
				{opened}
			</output>
			<output hidden aria-label="送信した参照">
				{sent}
			</output>
		</>
	);
}

const meta = {
	title: "Chat/Composer Copied Code",
	component: CopiedCodeStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CopiedCodeStory>;
export default meta;
type Story = StoryObj<typeof meta>;
/** 通常のコピーで記録したコードの貼り付けを再現する。 */
export const Ready: Story = {};
