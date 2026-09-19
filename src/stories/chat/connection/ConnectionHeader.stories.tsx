// 実際のチャット上でタイトル・接続遷移・表示先メッセージを再現する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatApp } from "../../../webview/chat/ChatApp";
import { createMockBridge } from "../mocks/mockBridge";
import type { Bridge } from "../../../webview/vscodeBridge";

/** Host専用操作を再現するBridgeで、下書きの復元も確認可能にする。 */
function HeaderStory({
	title = "",
	error = false,
}: {
	title?: string;
	error?: boolean;
}) {
	const bridge = useMemo(() => {
		const mock = createMockBridge(error ? "error" : "completed");
		mock.patchState({
			sessionTitle: title,
			sessionCapabilities: {
				list: true,
				load: true,
				fork: true,
				delete: true,
			},
		});
		let draft = "";
		let scrollTop = 0;
		const result: Bridge = {
			subscribe: mock.subscribe,
			postMessage(message) {
				if (message.type === "ui/setSidebar") {
					mock.emit({
						type: "ui/sidebarState",
						location: message.location,
					});
					mock.emit({
						type: "ui/viewState",
						editor: false,
						draft,
						scrollTop,
						restoreScroll: true,
					});
					return;
				}
				if (message.type === "ui/saveDraft") {
					draft = message.draft;
					return;
				}
				if (message.type === "ui/saveScroll") {
					scrollTop = message.scrollTop;
					return;
				}
				if (
					message.type === "ui/openEditor" ||
					message.type === "ui/openSidebar"
				) {
					mock.emit({
						type: "ui/viewState",
						editor: message.type === "ui/openEditor",
						draft,
						scrollTop,
						restoreScroll: true,
					});
					return;
				}
				mock.postMessage(message);
			},
		};
		return result;
	}, [title, error]);
	return <ChatApp bridge={bridge} />;
}
const meta = {
	title: "Chat/Header",
	component: HeaderStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof HeaderStory>;
export default meta;
/** ヘッダーの観察開始状態。 */
type Story = StoryObj<typeof meta>;
export const Untitled: Story = {};
export const LongTitle: Story = {
	args: {
		title: "セッションのタイトルを表示して、長い場合もアイコン操作が見切れないことを確認する",
	},
};
export const Reconnect: Story = {
	args: { error: true, title: "接続の復旧を確認する" },
};
