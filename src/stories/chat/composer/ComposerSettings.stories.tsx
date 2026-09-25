// 設定・使用量の非同期更新と添付の送信内容を実際のチャットで再現する。
import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatApp } from "../../../webview/chat/ChatApp";
import { createMockBridge } from "../mocks/mockBridge";
import type { UiMessage } from "../../../shared/messages";

/** テスト操作で通知を注入し、送信された要求も表示する。 */
function SettingsStory() {
	const mock = useMemo(() => createMockBridge("empty"), []);
	const [last, setLast] = useState<UiMessage>();
	const bridge = useMemo(
		() => ({
			subscribe: mock.subscribe,
			postMessage: (message: UiMessage) => {
				setLast(message);
				mock.postMessage(message);
			},
		}),
		[mock],
	);
	return (
		<>
			<div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
				<button
					onClick={() =>
						mock.patchState({
							quota: [
								{
									label: "codex 5h limit",
									remaining: 60,
									detail: "resets 18:00",
								},
								{
									label: "codex Weekly limit",
									remaining: 85,
									detail: "",
								},
							],
						})
					}
				>
					利用枠取得
				</button>
				<button onClick={() => mock.patchState({ quota: null })}>
					利用枠取得失敗
				</button>
				<button
					onClick={() =>
						mock.patchState({ usage: { used: 400, size: 1000 } })
					}
				>
					使用量40%
				</button>
				<button
					onClick={() =>
						mock.patchState({ usage: { used: 600, size: 1000 } })
					}
				>
					使用量60%
				</button>
				<button
					onClick={() =>
						mock.patchState({ usage: { used: 200, size: 1000 } })
					}
				>
					使用量20%
				</button>
				<button
					onClick={() =>
						mock.patchState({ connection: "disconnected" })
					}
				>
					切断通知
				</button>
			</div>
			<ChatApp bridge={bridge} />
			<output aria-label="最後の要求">
				{last && JSON.stringify(last)}
			</output>
		</>
	);
}
const meta = {
	title: "Chat/Composer Settings",
	component: SettingsStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SettingsStory>;
export default meta;
/** 操作と通知の競合を再現する Story。 */
type Story = StoryObj<typeof meta>;
export const Connected: Story = {};

/** App Server の `plan` 項目の本文を、通常の返信表示で確認する。 */
function ProposedPlanStory() {
	const bridge = useMemo(() => {
		const mock = createMockBridge("empty");
		mock.patchState({
			messages: [
				{
					id: "proposed-plan",
					role: "assistant",
					streaming: false,
					text: "## 認証機能の実装計画\n\n1. 既存の認証経路を調査する。\n2. セッション管理とエラー処理を実装する。\n3. 回帰テストを追加して検証する。",
				},
			],
		});
		return mock;
	}, []);
	return <ChatApp bridge={bridge} />;
}

export const ProposedPlan: Story = { render: () => <ProposedPlanStory /> };
