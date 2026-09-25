// シンボル候補の非同期応答と、チップから開く位置を確認する。
import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Bridge } from "../../../webview/vscodeBridge";
import { ChatApp } from "../../../webview/chat/ChatApp";
import { createMockBridge } from "../mocks/mockBridge";
import { mockWorkspaceSymbols } from "../mocks/mockWorkspaceSymbols";

/** 遅い検索が新しい検索を上書きしない状態を再現する。 */
function SymbolStory() {
	const [opened, setOpened] = useState("");
	const [queries, setQueries] = useState<string[]>([]);
	const [completed, setCompleted] = useState<string[]>([]);
	const bridge = useMemo(() => {
		const mock = createMockBridge("empty");
		return {
			subscribe: mock.subscribe,
			postMessage(message) {
				if (message.type === "reference/open") {
					setOpened(JSON.stringify(message));
					return;
				}
				if (message.type === "workspace/searchSymbols") {
					setQueries((previous) => [...previous, message.query]);
					// 遅延はストーリー専用。実装の待機条件は UI の状態で検証する。
					setTimeout(
						() => {
							mock.emit(mockWorkspaceSymbols(message));
							setCompleted((previous) => [
								...previous,
								message.query,
							]);
						},
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
