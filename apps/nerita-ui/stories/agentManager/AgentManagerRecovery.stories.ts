// 下書きの比較・復元と、新規作成時の入力開始を実際の画面で検証する。
import { expect, fn, userEvent, within, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import type {
	ManagerRequest,
	ManagerState,
} from "@nerita/shared/agentManager/messages";
import Preview from "./AgentManagerPreview.svelte";
import { sampleState } from "./managerStoryBridge";

const meta = {
	title: "Agent Manager Recovery",
	component: Preview,
	parameters: { layout: "fullscreen" },
	beforeEach: async () => {
		await waitFor(() =>
			expect(getComputedStyle(document.body).pointerEvents).not.toBe(
				"none",
			),
		);
	},
	args: {
		mode: "normal",
		onRequest: fn<(request: ManagerRequest) => void>(),
	},
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<{
	mode: string;
	initialState?: Partial<ManagerState>;
	onRequest: ReturnType<typeof fn<(request: ManagerRequest) => void>>;
}>;

/** 同じ項目の競合と、別の項目だけが変わった場合を分けて用意する。 */
function recoveryState(conflict: boolean): ManagerState {
	const state = sampleState();
	const agent = state.agents[0]!;
	const base = structuredClone(agent.edit);
	state.draft = {
		version: 1,
		backend: "pi",
		base: { type: "agent", agentId: agent.id, edit: base },
		change: {
			type: "agent",
			agentId: agent.id,
			edit: {
				...base,
				definition: {
					...base.definition!,
					description: "下書きの説明",
				},
			},
		},
	};
	agent.edit.definition = {
		...base.definition!,
		prompt: "外部で更新した指示",
		description: conflict
			? "外部で更新した説明"
			: base.definition!.description,
	};
	return state;
}
export const RestoreWithoutConflict: Story = {
	args: { initialState: recoveryState(false) },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByRole("textbox", { name: "説明" }),
		).toHaveValue("下書きの説明");
		await expect(
			canvas.getByRole("textbox", { name: "システムプロンプト" }),
		).toHaveValue("外部で更新した指示");
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		await waitFor(() =>
			expect(args.onRequest).toHaveBeenCalledWith(
				expect.objectContaining({ type: "draft", draft: null }),
			),
		);
	},
};
export const RestoreConflict: Story = {
	args: { initialState: recoveryState(true) },
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		const dialog = within(await page.findByRole("alertdialog"));
		await expect(
			dialog.getByRole("button", { name: "選択した値を復元" }),
		).toBeDisabled();
		await userEvent.click(dialog.getByRole("radio", { name: /下書き/ }));
		await userEvent.click(
			dialog.getByRole("button", { name: "選択した値を復元" }),
		);
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("textbox", { name: "説明" })).toHaveValue(
			"下書きの説明",
		);
		await expect(
			canvas.getByRole("textbox", { name: "システムプロンプト" }),
		).toHaveValue("外部で更新した指示");
		await waitFor(() =>
			expect(
				getComputedStyle(canvasElement.ownerDocument.body)
					.pointerEvents,
			).not.toBe("none"),
		);
	},
};
export const ConflictPreview: Story = {
	args: { initialState: recoveryState(true) },
};
export const DraftWriteFailure: Story = {
	args: { mode: "draft-write-error" },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			await canvas.findByRole("textbox", { name: "説明" }),
			"-保持する変更",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "再読み込み" }),
		);
		const dialog = within(
			await within(canvasElement.ownerDocument.body).findByRole(
				"alertdialog",
			),
		);
		await userEvent.click(
			dialog.getByRole("button", { name: "下書きを保存" }),
		);
		await expect(await dialog.findByRole("alert")).toHaveTextContent(
			"下書きファイルを保存できません。",
		);
		await expect(
			args.onRequest.mock.calls.filter(
				([request]) => request.type === "reload",
			),
		).toHaveLength(0);
		await userEvent.click(
			dialog.getByRole("button", { name: "編集を続ける" }),
		);
		await expect(canvas.getByRole("textbox", { name: "説明" })).toHaveValue(
			"プロジェクトの Agent-保持する変更",
		);
		await waitFor(() =>
			expect(
				getComputedStyle(canvasElement.ownerDocument.body)
					.pointerEvents,
			).not.toBe("none"),
		);
	},
};
export const InvalidDraftRecovery: Story = {
	args: { initialState: { draftError: "下書きの形式が不正です。" } },
	play: async ({ canvasElement }) => {
		const dialog = within(
			await within(canvasElement.ownerDocument.body).findByRole(
				"alertdialog",
			),
		);
		await userEvent.click(
			dialog.getByRole("button", { name: "後で確認する" }),
		);
		await expect(
			within(canvasElement).getByRole("textbox", { name: "名前" }),
		).toBeEnabled();
		await waitFor(() =>
			expect(
				getComputedStyle(canvasElement.ownerDocument.body)
					.pointerEvents,
			).not.toBe("none"),
		);
	},
};
export const KeepLatestConflict: Story = {
	args: { initialState: recoveryState(true) },
	play: async ({ canvasElement }) => {
		const dialog = within(
			await within(canvasElement.ownerDocument.body).findByRole(
				"alertdialog",
			),
		);
		await userEvent.click(
			dialog.getByRole("radio", { name: /最新の設定/ }),
		);
		await userEvent.click(
			dialog.getByRole("button", { name: "選択した値を復元" }),
		);
		await expect(
			within(canvasElement).getByRole("textbox", { name: "説明" }),
		).toHaveValue("外部で更新した説明");
		await waitFor(() =>
			expect(
				getComputedStyle(canvasElement.ownerDocument.body)
					.pointerEvents,
			).not.toBe("none"),
		);
	},
};
export const NewAgentKeyboardFocus: Story = {
	args: { mode: "codex" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const add = await canvas.findByRole("button", {
			name: "新しいエージェントを追加",
		});
		add.focus();
		await userEvent.keyboard("{Enter}");
		await expect(
			canvas.getByRole("textbox", { name: "名前" }),
		).toHaveFocus();
		await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
		await expect(
			canvasElement.querySelector('footer button[type="submit"]'),
		).toBeDisabled();
		await expect(
			canvas.getAllByText("GPT-6.1 Sol", { exact: true }),
		).toHaveLength(2);
	},
};
