// Piの認証待ち・取消・モデル変更を実チャットUIで観察する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatApp } from "../../webview/chat/ChatApp";
import { createMockBridge } from "./mocks/mockBridge";

/** ネイティブ認証画面の結果だけをモックする。 */
function PiAccountStory() {
	const bridge = useMemo(() => {
		const mock = createMockBridge();
		const options = [
			{ value: "local/first", name: "First (local)" },
			{ value: "local/second", name: "Second (local)" },
		];
		mock.patchState({
			piAccount: "local: 認証未設定",
			connection: "auth-required",
			authMethods: [{ id: "pi", name: "Piの認証情報を管理" }],
			attachmentsSupported: false,
			configOptions: [
				{
					id: "model",
					name: "Pi Model",
					currentValue: "local/first",
					options,
				},
			],
		});
		return {
			...mock,
			postMessage(message: Parameters<typeof mock.postMessage>[0]) {
				if (message.type === "auth/start") {
					mock.patchState(
						message.methodId === "pi-cancel"
							? {
									connection: "auth-required",
									sessionPending: false,
								}
							: {
									connection: "authenticating",
									sessionPending: true,
								},
					);
				} else if (message.type === "config/set") {
					mock.patchState({
						connection: "ready",
						piAccount: "local: APIキー・環境設定あり",
						configOptions: [
							{
								id: "model",
								name: "Pi Model",
								currentValue: message.value,
								options,
							},
						],
					});
				} else {
					mock.postMessage(message);
				}
			},
		};
	}, []);
	return <ChatApp bridge={bridge} />;
}
const meta = {
	title: "Chat/PiAccount",
	component: PiAccountStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PiAccountStory>;
export default meta;
/** 認証前からモデルを選び直す操作の開始状態。 */
type Story = StoryObj<typeof meta>;
export const Authentication: Story = {};
