// 保留を解消せずに各理由の操作を残し、一覧の実行先・バックエンド表示も比較する。
import { useEffect, useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import type { DlcView } from "@nerita/shared/dlc/contracts";
import { DlcIntentList } from "../../../src/chat/dlc/DlcIntentList";
import { useDlcWorkspace } from "../../../src/chat/dlc/useDlcWorkspace";
import { intentHoldView, intentExecutionView } from "../fixtures/dlcIntentList";
import { scenarioState } from "../fixtures/chatState";
import { createStoryBridge, type StoryBridge } from "../mocks/storyBridge";
import "../../../src/chat/chat.css";

/** 実フックの購読後に初期状態を配信し、操作への応答は自動で生成しない。 */
function IntentListStory({ view }: { view: DlcView }) {
	const bridge = useMemo(() => createStoryBridge(scenarioState("empty")), []);
	const ui = useDlcWorkspace(bridge);
	useEffect(() => bridge.emit({ type: "dlc/state", view }), [bridge, view]);
	return (
		<div
			className="grid h-screen max-w-[360px] grid-cols-1"
			data-story-intent-list
			ref={(element) => {
				if (element) {
					Object.assign(element, { bridge });
				}
			}}
		>
			<DlcIntentList ui={ui} />
		</div>
	);
}

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
