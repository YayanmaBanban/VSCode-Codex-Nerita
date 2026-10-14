// 保留理由と実行先・バックエンド表示、選択切り替えを実コンポーネントで検証する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import IntentListStory from "./IntentListStory.svelte";
import { intentHoldView, intentExecutionView } from "../fixtures/dlcIntentList";
import type { StoryBridge } from "../mocks/storyBridge";

const meta = {
	title: "Chat/DLC Intent List",
	component: IntentListStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof IntentListStory>;
export default meta;
type Story = StoryObj<typeof meta>;

/** 選択中の保留理由を表示し、詳細には操作ボタンやリンクを含めないことを確認する。 */
async function holdDetails(element: HTMLElement, label: string) {
	const canvas = within(element);
	const selected = await canvas.findByRole("button", {
		name: "開始を保留している Intent",
	});
	await waitFor(() => expect(selected).toHaveAccessibleDescription(label));
	await expect(selected).toHaveAttribute("aria-pressed", "true");
	const panels = canvas.getAllByLabelText("実行開始の保留");
	await expect(panels).toHaveLength(1);
	const panel = within(panels[0]!);
	await expect(panel.queryByRole("button")).not.toBeInTheDocument();
	await expect(panel.queryByRole("link")).not.toBeInTheDocument();
	await userEvent.hover(selected);
	const document = within(element.ownerDocument.body);
	await waitFor(() =>
		expect(document.getByRole("tooltip", { name: label })).toBeVisible(),
	);
	await userEvent.unhover(selected);
	const bridge = element.querySelector<HTMLElement & { bridge: StoryBridge }>(
		"[data-story-intent-list]",
	)!.bridge;
	return { panel, bridge };
}

export const WorktreeRequired: Story = {
	name: "ワークツリーの作成案内",
	args: { view: intentHoldView("worktree-required") },
	play: async ({ canvasElement }) => {
		const { panel } = await holdDetails(
			canvasElement,
			"ワークスペースでエージェントが実行中です。並行して実行するには、ワークツリーを作成してください",
		);
		await expect(panel.getByRole("status")).toHaveTextContent(
			"ワークスペースでエージェントが実行中です。並行して実行するには、ワークツリーを作成してください",
		);
	},
};

export const TrustRequired: Story = {
	name: "ワークスペースの信頼案内",
	args: { view: intentHoldView("trust-required") },
	play: async ({ canvasElement }) => {
		const { panel } = await holdDetails(
			canvasElement,
			"ワークスペースを信頼してください",
		);
		await expect(panel.getByRole("status")).toHaveTextContent(
			"ワークスペースを信頼してください",
		);
	},
};

export const Unavailable: Story = {
	name: "実行を開始できない状態",
	args: { view: intentHoldView("unavailable") },
	play: async ({ canvasElement }) => {
		const { panel, bridge } = await holdDetails(
			canvasElement,
			"実行を開始できません",
		);
		await expect(panel.getByRole("status")).toHaveTextContent(
			"実行先を確認できません。再読込みして Worktree を選択してください。",
		);
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: "再読み込み" }),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({ type: "dlc/read" });
	},
};

/** 選択の応答待ちと保留解除で詳細を閉じ、応答後に選択先の理由だけを表示する。 */
export const SelectionChanges: Story = {
	name: "選択の切り替えと保留解除",
	args: { view: intentHoldView("unavailable") },
	play: async ({ canvasElement }) => {
		const { bridge } = await holdDetails(
			canvasElement,
			"実行を開始できません",
		);
		const canvas = within(canvasElement);
		const next = canvas.getByRole("button", { name: "未選択の Intent" });
		await userEvent.click(next);
		await waitFor(() =>
			expect(canvas.queryByLabelText("実行開始の保留")).toBeNull(),
		);
		const view = intentHoldView("unavailable");
		const intent = view.intents[1]!;
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "dlc/select",
			intentId: intent.intentId,
		});

		const selectedView = {
			...view,
			selected: {
				...view.selected!,
				intentId: intent.intentId,
				title: intent.title,
			},
		};
		bridge.emit({ type: "dlc/state", view: selectedView });
		await waitFor(() =>
			expect(next).toHaveAttribute("aria-pressed", "true"),
		);
		await waitFor(() =>
			expect(canvas.getAllByLabelText("実行開始の保留")).toHaveLength(1),
		);
		await waitFor(() =>
			expect(
				within(canvas.getByLabelText("実行開始の保留")).getByRole(
					"status",
				),
			).toBeVisible(),
		);

		bridge.emit({
			type: "dlc/state",
			view: {
				...selectedView,
				intents: view.intents.map((item) => ({
					intentId: item.intentId,
					title: item.title,
					status: item.status,
				})),
			},
		});
		await waitFor(() =>
			expect(canvas.queryByLabelText("実行開始の保留")).toBeNull(),
		);
		await expect(next).toHaveAccessibleDescription("待機");
	},
};

export const ExecutionTargets: Story = {
	name: "実行先とバックエンド未指定",
	args: { view: intentExecutionView },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByRole("button", { name: "Codex で実行中" }),
		).toHaveTextContent("feature/codex-ui");
		await expect(
			canvas.getByRole("button", { name: "Pi で実行中" }),
		).toHaveTextContent("feature/pi-ui");
		await expect(
			canvas.getByRole("button", { name: "Codex の実行先が消失" }),
		).toHaveTextContent("ワークツリーが不明です");
		await expect(
			canvas.getByRole("button", { name: "Pi の実行先が消失" }),
		).toHaveTextContent("ワークツリーが不明です");
		await expect(
			canvas.getByRole("button", { name: "実行先を選んでいない Intent" }),
		).toHaveTextContent("バックエンドが未指定");
		await expect(
			canvas.queryByLabelText("実行開始の保留"),
		).not.toBeInTheDocument();
	},
};
