// Phase の開閉、タスク計画、実行・停止・再試行・履歴と工程操作を実際の UI で確認する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import PhasesStory from "./PhasesStory.svelte";
import { workspaceBridge } from "./workspaceBridge";
import { phasePlanning, phaseExecution } from "./phaseState";
import { first } from "./workspaceState";

const meta = {
	title: "Chat/DLC Phases",
	component: PhasesStory,
	args: { initialView: phasePlanning() },
	parameters: {
		layout: "fullscreen",
		docs: {
			description: {
				component:
					"実際の DlcPhases・タスクフォーム・依頼概要・会話と controller を利用します。工程データは Host の固定応答で、実行や保存は行いません。承認待ちなどの工程状態は表示のみで、未実装のフェーズ実行ボタンは追加していません。",
			},
		},
	},
} satisfies Meta<typeof PhasesStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ExpandAndCollapse: Story = {
	name: "全 Phase の開閉と展開位置の保存",
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = workspaceBridge(canvasElement);
		for (const phase of [0, 1, 2, 3, 4]) {
			const button = await canvas.findByRole("button", {
				name: new RegExp(`^Phase ${phase} ·`),
			});
			await expect(button).toHaveAttribute("aria-expanded", "true");
			await userEvent.click(button);
			await expect(button).toHaveAttribute("aria-expanded", "false");
			await userEvent.click(button);
			await expect(button).toHaveAttribute("aria-expanded", "true");
		}
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "dlc/editorState",
			state: { expanded: { [first]: [0, 1, 2, 3, 4] } },
		});
		await expect(
			bridge.sent.filter((message) => message.type === "dlc/action"),
		).toHaveLength(0);
	},
};

export const PlanRegistration: Story = {
	name: "手動タスクを追加してプラン登録",
	args: { expanded: [3] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = workspaceBridge(canvasElement);
		await expect(
			await canvas.findByRole("button", { name: "プランを登録" }),
		).toBeDisabled();
		await fillTask(
			canvasElement,
			"通知一覧を追加",
			"通知を一覧表示する",
			"src/notifications.ts",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "次のタスクを追加" }),
		);
		await expect(canvas.getByLabelText("タスク名")).toHaveValue("");
		await fillTask(
			canvasElement,
			"通知の検証",
			"通知の表示を検証する",
			"tests/notifications.ts, tests/fixtures.ts",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "プランを登録" }),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "dlc/action",
			intentId: first,
			revision: 0,
			action: {
				type: "plan",
				tasks: [
					{
						title: "通知一覧を追加",
						instructions: "通知を一覧表示する",
						paths: ["src/notifications.ts"],
					},
					{
						title: "通知の検証",
						instructions: "通知の表示を検証する",
						paths: ["tests/notifications.ts", "tests/fixtures.ts"],
					},
				],
			},
		});
	},
};

/** 実際のフォームへの入力操作だけを共通化し、タスクの組み立ては製品に任せる。 */
async function fillTask(
	element: HTMLElement,
	title: string,
	instructions: string,
	paths: string,
) {
	const canvas = within(element);
	await userEvent.type(canvas.getByLabelText("タスク名"), title);
	await userEvent.type(canvas.getByLabelText("実装する内容"), instructions);
	await userEvent.type(
		canvas.getByLabelText("対象ファイル（相対パス、カンマ区切り）"),
		paths,
	);
}

export const ReadyToRun: Story = {
	name: "実行待ち・実行要求",
	args: { initialView: phaseExecution("ready"), expanded: [3] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = workspaceBridge(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "手動タスクを実行" }),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "dlc/action",
			intentId: first,
			revision: 2,
			action: { type: "run" },
		});
		await expect(
			canvas.getByRole("button", { name: "実行を停止" }),
		).toBeDisabled();
	},
};

export const Running: Story = {
	name: "実行中・停止要求",
	args: { initialView: phaseExecution("running"), expanded: [3] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = workspaceBridge(canvasElement);
		await expect(
			await canvas.findByRole("button", { name: "手動タスクを実行" }),
		).toBeDisabled();
		await userEvent.click(
			canvas.getByRole("button", { name: "実行を停止" }),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "dlc/action",
			action: { type: "cancel" },
		});
	},
};

export const Stopping: Story = {
	name: "停止処理中",
	args: { initialView: phaseExecution("stopping"), expanded: [3] },
};

export const RetryAndHistory: Story = {
	name: "失敗・実行履歴・再試行準備",
	args: { initialView: phaseExecution("failed"), expanded: [3] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = workspaceBridge(canvasElement);
		const tasks = within(
			await canvas.findByRole("region", { name: "手動タスク" }),
		);
		await userEvent.click(tasks.getByRole("button", { name: /^実行 1 ·/ }));
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "dlc/attempt",
			intentId: first,
			attemptId: "notification-attempt",
		});
		await userEvent.selectOptions(
			canvas.getByRole("combobox", { name: "DLC の実行履歴" }),
			"notification-attempt",
		);
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "dlc/attempt",
			attemptId: "notification-attempt",
		});
		await userEvent.click(
			tasks.getByRole("button", { name: "変更を確認して再試行を準備" }),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "dlc/action",
			action: { type: "retry", workItemId: "notification-task" },
		});
		await expect(
			bridge.sent.filter(
				(message) =>
					message.type === "dlc/action" &&
					message.action.type === "run",
			),
		).toHaveLength(0);
	},
};

export const Cancelled: Story = {
	name: "停止済み・再試行可能",
	args: { initialView: phaseExecution("cancelled"), expanded: [3] },
};

export const Interrupted: Story = {
	name: "中断・変更確認が必要",
	args: { initialView: phaseExecution("interrupted"), expanded: [3] },
};

export const NewIntent: Story = {
	name: "未選択・Phase 0 の作成フォーム",
	args: {
		initialView: { ...phasePlanning(), selected: null, intents: [] },
		expanded: [0],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		for (const phase of [0, 1, 2, 3, 4]) {
			await expect(
				await canvas.findByRole("button", {
					name: new RegExp(`^Phase ${phase} ·`),
				}),
			).toBeDisabled();
		}
		await expect(canvas.getByLabelText("Intent のタイトル")).toBeEnabled();
	},
};

export const AwaitingReview: Story = {
	name: "実装済み・レビュー待ち",
	args: { initialView: phaseExecution("implemented"), expanded: [3] },
};

export const StageStates: Story = {
	name: "工程の実行中・承認待ち・修正中",
	args: {
		initialView: {
			...phasePlanning(),
			selected: {
				...phasePlanning().selected!,
				stages: [
					{
						id: "0.1",
						name: "Workspace",
						selection: "execute",
						status: "completed",
						reason: "作業領域を確認済み",
					},
					{
						id: "1.1",
						name: "Ideation",
						selection: "execute",
						status: "active",
						reason: "方針を整理中",
					},
					{
						id: "2.1",
						name: "Requirements",
						selection: "execute",
						status: "awaiting-approval",
						reason: "要件の承認待ち",
					},
					{
						id: "3.1",
						name: "Implementation",
						selection: "execute",
						status: "revising",
						reason: "レビューの指摘を反映中",
					},
					{
						id: "4.1",
						name: "Operation",
						selection: "skip",
						status: "skipped",
						reason: "今回は運用変更なし",
					},
				],
			},
		},
	},
};

export const AdvanceAndArchive: Story = {
	name: "工程の実行条件を確認・アーカイブ",
	args: { expanded: [0] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const bridge = workspaceBridge(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "工程の実行条件を確認" }),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "dlc/action",
			action: { type: "advance" },
		});
		await userEvent.click(
			canvas.getByRole("button", { name: "アーカイブ" }),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "dlc/action",
			action: { type: "archive" },
		});
		bridge.emit({
			type: "dlc/state",
			view: {
				...phasePlanning(),
				selected: {
					...phasePlanning().selected!,
					workflowStatus: "archived",
				},
			},
		});
		await waitFor(() =>
			expect(
				canvas.getByRole("button", { name: "アーカイブ" }),
			).toBeDisabled(),
		);
		await expect(
			canvas.getByRole("button", { name: "工程の実行条件を確認" }),
		).toBeDisabled();
	},
};
