// 接続・会話・承認・障害状態を同じ UI で再現し、基本操作をブラウザで検証する。
import type { ChatState } from "@nerita/shared/chatState";
import { useMemo } from "react";
import { expect, userEvent, within, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { StoryChat as ChatApp, storyBridge } from "./StoryChat";
import { createChatStoryBridge, type Scenario } from "./mocks/mockBridge";
import { createAppServerBridge } from "./mocks/appServerBridge";
import { createCodexLifecycleBridge } from "./mocks/codexLifecycleBridge";
import { createPiBridge } from "./mocks/piBridge";
import { createPiApprovalBridge } from "./mocks/piApprovalBridge";
import { createPiHistoryBridge } from "./mocks/piHistoryBridge";

/** 各マウントで独立するブリッジをストーリーへ注入する。 */
function ChatStory({
	scenario,
	appServer = false,
	pi = false,
	piTools = false,
	piNestedTools = false,
	piApprovals = false,
	piHistory = false,
	piRun = "idle",
	approvalTool = "write",
}: {
	scenario: Scenario;
	appServer?: boolean;
	pi?: boolean;
	piTools?: boolean;
	piNestedTools?: boolean;
	piApprovals?: boolean;
	piHistory?: boolean;
	piRun?: ChatState["run"];
	approvalTool?: string;
}) {
	const bridge = useMemo(() => {
		if (piHistory) {
			return createPiHistoryBridge();
		}
		if (piApprovals) {
			return createPiApprovalBridge(approvalTool);
		}
		if (pi || piTools || piNestedTools) {
			return createPiBridge(piTools, piRun, piNestedTools);
		}
		if (appServer) {
			return createAppServerBridge(scenario);
		}
		if (scenario === "auth") {
			return createCodexLifecycleBridge("success");
		}
		if (scenario === "error") {
			return createCodexLifecycleBridge("reconnect");
		}
		return createChatStoryBridge(scenario);
	}, [
		scenario,
		appServer,
		pi,
		piTools,
		piNestedTools,
		piApprovals,
		piHistory,
		piRun,
		approvalTool,
	]);
	return <ChatApp bridge={bridge} />;
}
const meta = {
	title: "Chat/App",
	component: ChatStory,
	parameters: { layout: "fullscreen" },
	args: { scenario: "empty", approvalTool: "write", piRun: "idle" },
} satisfies Meta<typeof ChatStory>;
export default meta;
/** チャット画面のストーリー定義。 */
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const Pi: Story = { args: { pi: true } };
export const PiTools: Story = { args: { piTools: true, piRun: "completed" } };
export const PiNestedTools: Story = {
	args: { piNestedTools: true, piRun: "running" },
};
export const PiNestedHistory: Story = {
	args: { piNestedTools: true, piRun: "completed" },
};
export const PiApprovals: Story = { args: { piApprovals: true } };
export const PiHistory: Story = { args: { piHistory: true } };
export const AppServer: Story = { args: { appServer: true } };
export const AppServerStreaming: Story = {
	args: { scenario: "streaming", appServer: true },
};
export const AppServerPermission: Story = {
	args: { scenario: "permission", appServer: true },
};
export const Connecting: Story = { args: { scenario: "connecting" } };
export const Authentication: Story = { args: { scenario: "auth" } };
export const Streaming: Story = { args: { scenario: "streaming" } };
export const Completed: Story = { args: { scenario: "completed" } };
export const Permission: Story = { args: { scenario: "permission" } };
export const Cancelled: Story = { args: { scenario: "cancelled" } };
export const Cancelling: Story = { args: { scenario: "cancelling" } };
export const Failed: Story = { args: { scenario: "failed" } };
export const Error: Story = { args: { scenario: "error" } };

export const PiStreaming: Story = { args: { pi: true, piRun: "running" } };
export const PiCompleted: Story = { args: { pi: true, piRun: "completed" } };
export const PiCancelled: Story = { args: { pi: true, piRun: "cancelled" } };

/** 承認要求の ID を保ち、Host 応答が届くまで表示状態を確定しない。 */
export const ApprovalRequest: Story = {
	args: { scenario: "permission", appServer: true },
	play: approvalPlay("今回のみ許可", "accept"),
};

/** カーテン付きの拒否ボタンから、拒否に対応する選択肢 ID を送信する。 */
export const ApprovalDeclined: Story = {
	args: { scenario: "permission", appServer: true },
	play: approvalPlay("拒否", "decline"),
};
/** カーテン付きの中止ボタンから、ターン中止に対応する選択肢 ID を送信する。 */
export const ApprovalCancelled: Story = {
	args: { scenario: "permission", appServer: true },
	play: approvalPlay("ターンを中止", "cancel"),
};

/** 要求と選択肢の ID を送信し、Host の応答まで承認カードが残ることを確認する。 */
function approvalPlay(
	name: string,
	optionId: string,
): NonNullable<Story["play"]> {
	return async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = storyBridge(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name }));
		await expect(bridge.sent).toContainEqual(
			expect.objectContaining({
				type: "permission/respond",
				permissionId: "permission",
				optionId,
				sessionId: "story-session",
				runId: "story-run",
			}),
		);
		await expect(
			canvas.getByRole("region", { name: "承認要求" }),
		).toBeVisible();
		bridge.patchState({ permissions: [], run: "completed" });
		await waitFor(() =>
			expect(
				canvas.queryByRole("region", { name: "承認要求" }),
			).not.toBeInTheDocument(),
		);
	};
}
