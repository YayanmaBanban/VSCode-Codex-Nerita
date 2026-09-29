// 実際のチャット上でタイトル・接続遷移・表示先メッセージを再現する。
import { useMemo, useState } from "react";
import { initialState, type ConnectionStatus } from "@nerita/shared/chatState";
import { createCodexLifecycleBridge } from "../mocks/codexLifecycleBridge";
import { ConnectionButton } from "../../../src/chat/connection/ConnectionButton";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { StoryChat as ChatApp } from "../StoryChat";
import { createChatStoryBridge } from "../mocks/mockBridge";
import type { BackendId } from "@nerita/shared/backend";

/** ヘッダーの初期状態を注入し、表示先の操作は記録する。 */
function HeaderStory({
	title = "",
	error = false,
	authFailure = false,
	authSuccess = false,
	backend = "codex",
}: {
	title?: string;
	error?: boolean;
	authFailure?: boolean;
	authSuccess?: boolean;
	backend?: BackendId;
}) {
	const bridge = useMemo(() => {
		if (error) {
			return createCodexLifecycleBridge("reconnect");
		}
		if (authFailure) {
			return createCodexLifecycleBridge("failure");
		}
		if (authSuccess) {
			return createCodexLifecycleBridge("success");
		}
		const mock = createChatStoryBridge("completed", backend);
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
		const post = mock.postMessage.bind(mock);
		return {
			...mock,
			postMessage(message: Parameters<typeof post>[0]) {
				post(message);
				if (message.type === "ui/ready") {
					mock.emit({ type: "ui/backendState", backend });
				}
			},
		};
	}, [title, error, backend, authFailure, authSuccess]);
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
export const AuthenticationFailure: Story = {
	args: { authFailure: true },
};
export const AuthenticationSuccess: Story = {
	args: { authSuccess: true },
};

/** 接続状態を任意に切り替え、連続した変更や待機中の演出を確認する。 */
function ConnectionTransitions() {
	const [state, setState] = useState(initialState);
	const connections: ConnectionStatus[] = [
		"disconnected",
		"connecting",
		"authenticating",
		"ready",
		"error",
	];
	return (
		<div style={{ padding: 24 }}>
			<ConnectionButton state={state} send={() => {}} />
			<div
				style={{
					marginTop: 24,
					display: "flex",
					flexWrap: "wrap",
					gap: 8,
				}}
			>
				{connections.map((connection) => (
					<button
						key={connection}
						onClick={() =>
							setState({
								...state,
								connection,
								sessionPending: true,
							})
						}
					>
						{connection}
					</button>
				))}
			</div>
		</div>
	);
}
export const Transitions: Story = { render: () => <ConnectionTransitions /> };
