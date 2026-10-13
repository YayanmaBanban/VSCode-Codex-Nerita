// 保留操作と実行先・バックエンド表示を Svelte の実コンポーネントで検証する。
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

/** 状態の説明と保留パネルが初期表示に残り、未選択の保留操作は出ないことを確認する。 */
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
	await expect(
		panel.getByRole("link", { name: "実行先を選択" }),
	).toHaveAttribute("href", "#dlc-worktree");
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
	name: "Worktree が必要",
	args: { view: intentHoldView("worktree-required") },
	play: async ({ canvasElement }) => {
		const { panel, bridge } = await holdDetails(
			canvasElement,
			"Worktree が必要",
		);
		await expect(panel.getByRole("status")).toHaveTextContent(
			"この実行先は別の処理で使用中です。独立した Worktree を選択してください。",
		);
		await expect(
			panel.queryByRole("button", { name: "信頼設定を開く" }),
		).not.toBeInTheDocument();
		await userEvent.click(
			panel.getByRole("button", { name: "新しい Worktree を作成" }),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({
			type: "dlc/worktreeCreate",
		});
		await userEvent.click(
			panel.getByRole("button", { name: "開始条件を再確認" }),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({ type: "dlc/read" });
	},
};

export const TrustRequired: Story = {
	name: "信頼の確認が必要",
	args: { view: intentHoldView("trust-required") },
	play: async ({ canvasElement }) => {
		const { panel, bridge } = await holdDetails(
			canvasElement,
			"信頼の確認が必要",
		);
		await expect(panel.getByRole("status")).toHaveTextContent(
			"実行先の Nerita Trust を確認してください。",
		);
		await expect(
			panel.queryByRole("button", { name: "新しい Worktree を作成" }),
		).not.toBeInTheDocument();
		await userEvent.click(
			panel.getByRole("button", { name: "信頼設定を開く" }),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({ type: "dlc/trust" });
	},
};

export const Unavailable: Story = {
	name: "開始条件の確認が必要",
	args: { view: intentHoldView("unavailable") },
	play: async ({ canvasElement }) => {
		const { panel, bridge } = await holdDetails(
			canvasElement,
			"開始条件の確認が必要",
		);
		await expect(panel.getByRole("status")).toHaveTextContent(
			"実行先の状態を取得できません。開始条件を再確認してください。",
		);
		await expect(
			panel.queryByRole("button", { name: "新しい Worktree を作成" }),
		).not.toBeInTheDocument();
		await expect(
			panel.queryByRole("button", { name: "信頼設定を開く" }),
		).not.toBeInTheDocument();
		await userEvent.click(
			panel.getByRole("button", { name: "開始条件を再確認" }),
		);
		await expect(bridge.sent.at(-1)).toMatchObject({ type: "dlc/read" });
	},
};

export const ExecutionTargets: Story = {
	name: "実行先とバックエンド",
	args: { view: intentExecutionView },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByRole("button", { name: "Codex で実行中" }),
		).toHaveTextContent("feature/codex-ui · Codex");
		await expect(
			canvas.getByRole("button", { name: "Pi で実行中" }),
		).toHaveTextContent("feature/pi-ui · Pi");
		await expect(
			canvas.getByRole("button", { name: "Codex の実行先が消失" }),
		).toHaveTextContent("消失した Worktree · Codex");
		await expect(
			canvas.getByRole("button", { name: "Pi の実行先が消失" }),
		).toHaveTextContent("消失した Worktree · Pi");
		await expect(
			canvas.getByRole("button", { name: "実行先を選んでいない Intent" }),
		).toHaveTextContent("実行先未選択");
		await expect(
			canvas.queryByLabelText("実行開始の保留"),
		).not.toBeInTheDocument();
	},
};
