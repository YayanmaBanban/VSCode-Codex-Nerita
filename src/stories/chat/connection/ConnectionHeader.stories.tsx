// 実際のチャット上でタイトル・接続遷移・表示先メッセージを再現する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatApp } from "../../../webview/chat/ChatApp";
import { createMockBridge } from "../mocks/mockBridge";
import type { Bridge } from "../../../webview/vscodeBridge";
import type { BackendId } from "../../../shared/backend";

/** Host 専用操作を再現する Bridge で、下書きの復元も確認可能にする。 */
function HeaderStory({
	title = "",
	error = false,
	backend = "codex",
}: {
	title?: string;
	error?: boolean;
	backend?: BackendId;
}) {
	const bridge = useMemo(() => {
		const mock = createMockBridge(error ? "error" : "completed");
		mock.patchState({
			piAccount: backend === "pi" ? "local: 認証未設定" : null,
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
				if (message.type === "ui/ready") {
					mock.emit({ type: "ui/backendState", backend });
				}
				if (message.type === "ui/setBackend") {
					mock.emit({
						type: "ui/backendState",
						backend: message.backend,
					});
					return;
				}
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
	}, [title, error, backend]);
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
export const PiBackend: Story = {
	args: { backend: "pi" },
};
