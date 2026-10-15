// ワークスペースの案内・エラー・待機状態を用意し、通信要求と Host 応答を確認する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import WorkspaceStory from "./WorkspaceStory.svelte";
import { workspaceBridge } from "./workspaceBridge";
import { environmentView, first, second } from "./workspaceState";

const failed = {
	...environmentView(),
	error: "保存データを読み込めませんでした。保存記録を確認してください。",
};
const meta = {
	title: "Chat/DLC Workspace States",
	component: WorkspaceStory,
	parameters: {
		layout: "fullscreen",
		docs: {
			description: {
				component:
					"DLC の作業画面全体の状態を確認します。製品の UI と状態管理処理を使い、Host の応答はストーリーで指定します。ボタン操作による要求は通信のモックに記録され、保存や実行は行いません。Chat/DLC Workspace には、作成・選択・実行先変更・信頼・長押し削除の操作シナリオがあります。",
			},
		},
	},
} satisfies Meta<typeof WorkspaceStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ErrorRecovery: Story = {
	name: "画面上部のエラー・実行環境の操作",
	args: { initialView: failed },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = workspaceBridge(canvasElement);
		const alert = await canvas.findByRole("alert");
		await expect(alert).toHaveTextContent(failed.error);
		await expect(
			within(alert).queryByRole("button"),
		).not.toBeInTheDocument();
		await userEvent.click(
			canvas.getByRole("combobox", { name: "DLC の Worktree" }),
		);
		await userEvent.click(
			within(canvasElement.ownerDocument.body).getByRole("button", {
				name: "新しいWorktreeを作成",
			}),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "dlc/worktreeCreate",
		});
		await expect(alert).toBeVisible();
	},
};

export const RecoverySucceeded: Story = {
	name: "復旧応答後にエラーを解除",
	args: { initialView: failed },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = workspaceBridge(canvasElement);
		await canvas.findByRole("alert");
		bridge.emit({ type: "dlc/state", view: environmentView() });
		await waitFor(() =>
			expect(canvas.queryByRole("alert")).not.toBeInTheDocument(),
		);
		await expect(
			canvas.getByRole("button", { name: "最初の Intent" }),
		).toHaveAttribute("aria-pressed", "true");
	},
};

export const UntrustedStartup: Story = {
	name: "未信頼で起動しても信頼管理を開ける",
	args: {
		initialView: {
			...environmentView(),
			selected: null,
			intents: [],
			error: "DLC のワークスペースを信頼してください。信頼管理画面で設定できます。",
			targets: environmentView().targets.map((target) => ({
				...target,
				trusted: false,
			})),
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = workspaceBridge(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", {
				name: "ワークスペースを信頼する",
			}),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({ type: "dlc/trust" });
		await expect(
			canvas.getByRole("combobox", { name: "DLC のバックエンド" }),
		).toBeDisabled();
		await expect(
			canvas.getByRole("combobox", { name: "DLC の Worktree" }),
		).toBeDisabled();
		await expect(canvas.getByRole("alert")).toBeVisible();
	},
};

export const OtherIntentRunning: Story = {
	name: "別 Intent 実行中・実行中の Intent を表示",
	args: {
		initialView: {
			...environmentView(),
			active: { intentId: second, attemptId: "other-attempt" },
			running: [
				{
					intentId: second,
					attemptId: "other-attempt",
					targetId: "worktree",
				},
			],
			intents: [
				{ intentId: first, title: "最初の Intent", status: "idle" },
				{ intentId: second, title: "別の Intent", status: "running" },
			],
		},
		expanded: [0, 3],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = workspaceBridge(canvasElement);
		const conversation = await canvas.findByRole("region", {
			name: "Worktree の会話",
		});
		await userEvent.click(
			within(conversation).getByRole("button", {
				name: "実行中の Intent を表示",
			}),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "dlc/select",
			intentId: second,
		});
		await expect(
			canvas.getByRole("button", { name: "最初の Intent" }),
		).toHaveAttribute("aria-pressed", "true");
	},
};

export const AssignmentPending: Story = {
	name: "実行先・バックエンドの保存中",
	args: { initialView: { ...environmentView(), assignmentPending: true } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByRole("combobox", { name: "DLC のバックエンド" }),
		).toBeDisabled();
		await expect(
			canvas.getByRole("combobox", { name: "DLC の Worktree" }),
		).toBeDisabled();
	},
};

export const SelectionPending: Story = {
	name: "別 Intent の選択応答待ち",
	args: { initialView: environmentView() },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = workspaceBridge(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "別の Intent" }),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "dlc/select",
			intentId: second,
		});
		await expect(
			canvas.queryByText("最初の Intent の依頼原文"),
		).not.toBeInTheDocument();
	},
};

export const EmptyWorkspace: Story = {
	name: "Intent がない状態・新規作成フォーム",
	args: {
		initialView: { ...environmentView(), selected: null, intents: [] },
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByLabelText("Intent のタイトル"),
		).toBeEnabled();
		await expect(
			canvas.getByRole("button", { name: "Intent を作成" }),
		).toBeDisabled();
		await expect(
			canvas.getByRole("combobox", { name: "DLC のバックエンド" }),
		).toBeDisabled();
		await expect(
			canvas.getByRole("combobox", { name: "DLC の Worktree" }),
		).toBeDisabled();
		await expect(canvas.getByRole("status")).toHaveTextContent(
			"Intentの作成・選択を待っています",
		);
	},
};
