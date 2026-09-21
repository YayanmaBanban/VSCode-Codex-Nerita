// 認証専用エディターを外部ログインなしで操作確認する。
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PiAuthState } from "../../shared/piAuth";
import { PiAuthEditor } from "../../webview/pi-auth/PiAuthEditor";

/** Host同様に認証先ごとの通知を保持する。 */
function feedback(
	state: PiAuthState,
	methodId: string,
	notice: string,
	error: string | null,
) {
	const owner = state.items.find((item) =>
		item.methods.some((method) => method.id === methodId),
	)!.id;
	return { ...state.feedback, [owner]: { notice, error } };
}

/** 認証入力・OAuth・取消後の表示を再現する。 */
function EditorStory() {
	const [state, setState] = useState<PiAuthState>({
		items: [
			{
				id: "anthropic",
				name: "Anthropic",
				configured: true,
				methods: [
					{ id: "anthropic-key", name: "APIキーを設定" },
					{ id: "anthropic-oauth", name: "OAuthでログイン" },
				],
			},
			{
				id: "openai",
				name: "OpenAI",
				configured: false,
				methods: [
					{ id: "openai-key", name: "APIキーを設定" },
					{ id: "openai-oauth", name: "OAuthでログイン" },
				],
			},
			{
				id: "google",
				name: "Google",
				configured: false,
				methods: [{ id: "google-key", name: "APIキーを設定" }],
			},
		],
		active: null,
		prompt: null,
		notice: "",
		error: null,
	});
	return (
		<PiAuthEditor
			state={state}
			send={(request) => {
				if (request.type === "start") {
					setState((current) => ({
						...current,
						active: request.id,
						feedback: feedback(
							current,
							request.id,
							request.id.endsWith("oauth")
								? "ブラウザで認証を完了してください。"
								: "",
							null,
						),
						prompt: {
							id: request.id,
							message: request.id.endsWith("oauth")
								? "確認コードを入力してください"
								: "APIキーを入力してください",
							secret: true,
						},
						notice: request.id.endsWith("oauth")
							? "ブラウザで認証を完了してください。"
							: "",
						error: null,
					}));
				}
				if (request.type === "cancel") {
					setState((current) => ({
						...current,
						active: null,
						prompt: null,
						notice: "",
						error: "認証をキャンセルしました。",
						feedback: feedback(
							current,
							current.active!,
							"",
							"認証をキャンセルしました。",
						),
					}));
				}
				if (request.type === "answer") {
					setState((current) => ({
						...current,
						active: null,
						prompt: null,
						notice: "認証情報を更新しました。",
						feedback: feedback(
							current,
							request.id,
							"認証情報を更新しました。",
							null,
						),
						error: null,
						items: current.items.map((item) =>
							item.methods.some(
								(method) => method.id === request.id,
							)
								? { ...item, configured: true }
								: item,
						),
					}));
				}
			}}
		/>
	);
}
const meta = {
	title: "Chat/PiAuthEditor",
	component: EditorStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof EditorStory>;
export default meta;
/** 一覧表示から認証処理へ進む開始状態。 */
type Story = StoryObj<typeof meta>;
export const Providers: Story = {};
