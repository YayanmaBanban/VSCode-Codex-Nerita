// 設定・使用量の非同期更新と添付の送信内容を実際のチャットで再現する。

import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { StoryChat as ChatApp } from "../StoryChat";
import { createChatStoryBridge } from "../mocks/mockBridge";
import type { UiMessage } from "@nerita/shared/messages";
import { settingsFixture } from "../fixtures/settingsFixture";

/** 設定表示のストーリーで使う権限モードと承認者。 */
type SettingsStoryProps = {
	mode?: string;
	reviewer?: string;
};

/** テスト操作で通知を注入し、送信された要求も表示する。 */
function SettingsStory({
	mode = "workspace-write",
	reviewer = "user",
}: SettingsStoryProps) {
	const mock = useMemo(createSettingsStoryBridge(mode, reviewer), [
		mode,
		reviewer,
	]);
	const [last, setLast] = useState<UiMessage>();
	const bridge = useMemo(
		() => ({
			...mock,
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
			{<SettingsStoryControls mock={mock} />}
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
/** 操作と通知の競合を再現するストーリー。 */
type Story = StoryObj<typeof meta>;
export const Connected: Story = {};

/** 権限と承認者を固定し、カードを開いて見た目を比較する。 */
export const ReadOnly: Story = { args: { mode: "read-only" } };
export const WorkspaceWriteUser: Story = {
	args: { mode: "workspace-write", reviewer: "user" },
};
export const WorkspaceWriteAutoReview: Story = {
	args: { mode: "workspace-write", reviewer: "auto_review" },
};
export const FullAccess: Story = { args: { mode: "danger-full-access" } };

/** 利用枠・使用量・切断の通知を操作で注入する。 */
function SettingsStoryControls({
	mock,
}: {
	mock: ReturnType<typeof createChatStoryBridge>;
}) {
	return (
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
				onClick={() => mock.patchState({ connection: "disconnected" })}
			>
				切断通知
			</button>
		</div>
	);
}

/** モードと承認者の組合せを初期状態へ反映する。 */
function createSettingsStoryBridge(
	mode: string,
	reviewer: string,
): () => ReturnType<typeof createChatStoryBridge> {
	return () => {
		const bridge = createChatStoryBridge("empty");
		bridge.patchState({
			configOptions: settingsFixture().map((option) => {
				if (option.id === "mode") {
					return { ...option, currentValue: mode };
				}
				if (option.id === "approvals_reviewer") {
					return { ...option, currentValue: reviewer };
				}
				return option;
			}),
		});
		return bridge;
	};
}

/** App Server の `plan` 項目の本文を、通常の返信表示で確認する。 */
function ProposedPlanStory() {
	const bridge = useMemo(() => {
		const mock = createChatStoryBridge("empty");
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
