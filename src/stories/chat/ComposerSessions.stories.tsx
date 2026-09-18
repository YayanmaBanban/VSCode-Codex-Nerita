// セッションチップの保存・復元・送信失敗を実際のチャットUIで確認する。
import { useMemo, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatApp } from "../../webview/chat/ChatApp";
import type { Bridge } from "../../webview/vscodeBridge";
import type { ComposerPart } from "../../shared/composerContent";
import { createMockBridge } from "./mocks/mockBridge";

/** 参照元の会話をロードせず、送信される参照IDだけを観測する。 */
function SessionStory() {
	const [view, setView] = useState(false);
	const [sent, setSent] = useState("");
	const [opened, setOpened] = useState("");
	const fail = useRef(false);
	const bridge = useMemo(() => {
		const mock = createMockBridge("empty");
		let draft = "";
		let parts: ComposerPart[] | undefined;
		let editor = false;
		return {
			subscribe: mock.subscribe,
			postMessage(message) {
				if (message.type === "session/openReference") {
					setOpened(message.referencedSessionId);
					return;
				}
				if (message.type === "ui/saveDraft") {
					draft = message.draft;
					parts = message.draftParts;
					return;
				}
				if (
					message.type === "ui/openEditor" ||
					message.type === "ui/openSidebar"
				) {
					editor = message.type === "ui/openEditor";
					setView(editor);
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
				if (message.type === "ui/ready") {
					mock.emit({
						type: "ui/viewState",
						editor,
						draft,
						...(parts ? { draftParts: parts } : {}),
						scrollTop: 0,
						restoreScroll: true,
					});
				}
			},
		} satisfies Bridge;
	}, []);
	return (
		<>
			<ChatApp key={String(view)} bridge={bridge} />
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
		</>
	);
}
const meta = {
	title: "Chat/Composer Sessions",
	component: SessionStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SessionStory>;
export default meta;
/** 本文の参照チップを操作するStory。 */
type Story = StoryObj<typeof meta>;
export const References: Story = {};
