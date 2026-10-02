// シンボル候補の非同期応答と、チップから開く位置を確認する。

import { type SetStateAction, type Dispatch, useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Bridge } from "@nerita/shared/bridge";
import { StoryChat as ChatApp } from "../StoryChat";
import { createChatStoryBridge } from "../mocks/mockBridge";
import { mockWorkspaceSymbols } from "../mocks/mockWorkspaceSymbols";
import { type ChatState } from "@nerita/shared/chatState";
import { type UiMessage, type HostMessage } from "@nerita/shared/messages";
import { type WorkspaceSymbolsRequest } from "@nerita/shared/workspaceSymbols";

/** 遅い検索が新しい検索を上書きしない状態を再現する。 */
function SymbolStory() {
	const [sent, setSent] = useState("");
	const [opened, setOpened] = useState("");
	const [queries, setQueries] = useState<string[]>([]);
	const [completed, setCompleted] = useState<string[]>([]);
	const bridge = useMemo(() => {
		const mock = createChatStoryBridge("empty");
		return {
			...mock,
			subscribe: mock.subscribe,
			postMessage(message) {
				if (message.type === "prompt/send") {
					setSent(message.text);
				}
				if (message.type === "reference/open") {
					setOpened(JSON.stringify(message));
					return;
				}
				if (message.type === "workspace/searchSymbols") {
					setQueries((previous) => [...previous, message.query]);
					// 遅延はストーリー専用。実装の待機条件は UI の状態で検証する。
					setTimeout(
						createSymbolReply(mock, message, setCompleted),
						message.query === "slow" ? 800 : 0,
					);
					return;
				}
				mock.postMessage(message);
			},
		} satisfies Bridge;
	}, []);
	return (
		<>
			<ChatApp bridge={bridge} />
			<output hidden aria-label="送信した本文">
				{sent}
			</output>
			<output hidden aria-label="開いた参照">
				{opened}
			</output>
			<output hidden aria-label="検索したシンボル">
				{JSON.stringify(queries)}
			</output>
			<output hidden aria-label="検索完了">
				{JSON.stringify(completed)}
			</output>
		</>
	);
}
const meta = {
	title: "Chat/Composer Symbols",
	component: SymbolStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SymbolStory>;
export default meta;
/** 検索から挿入・送信まで操作できるストーリー。 */
type Story = StoryObj<typeof meta>;
export const Search: Story = {};

/** 検索の完了を遅延通知して旧結果との競合を再現する。 */
function createSymbolReply(
	mock: {
		patchState(patch: Partial<ChatState>): void;
		postMessage(message: Parameters<(message: UiMessage) => void>[0]): void;
		subscribe: (listener: (message: HostMessage) => void) => () => void;
		sent: UiMessage[];
		emit(message: HostMessage): void;
	},
	message: WorkspaceSymbolsRequest,
	setCompleted: Dispatch<SetStateAction<string[]>>,
): () => void {
	return () => {
		mock.emit(mockWorkspaceSymbols(message));
		setCompleted((previous) => [...previous, message.query]);
	};
}
