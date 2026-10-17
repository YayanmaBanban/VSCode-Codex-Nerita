// 途中で修正・保存せず、条件付きの警告や入力制約を目視確認できる状態で保持する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, fn, userEvent, within, waitFor } from "storybook/test";
import Preview from "./AgentManagerPreview.svelte";
import { sampleState } from "./managerStoryBridge";

const state = sampleState();
const codex = state.agents.find((agent) => agent.backend === "codex")!;
const meta = {
	title: "Agent Manager/States",
	component: Preview,
	parameters: { layout: "fullscreen" },
	args: { mode: "normal", onRequest: fn() },
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const InvalidName: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.clear(
			await canvas.findByRole("textbox", { name: "名前" }),
		);
		await expect(canvas.getByRole("alert")).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "変更を保存" }),
		).toBeDisabled();
	},
};
export const ReadOnlyAgent: Story = {
	args: {
		mode: "codex",
		initialState: { agents: [{ ...codex, editable: false }] },
	},
	play: async ({ canvasElement }) => {
		await expect(
			await within(canvasElement).findByRole("textbox", { name: "名前" }),
		).toBeDisabled();
	},
};
export const UnsupportedAgent: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "external-runner" }),
		);
		await expect(canvas.getByRole("status")).toBeVisible();
	},
};
export const InheritedAgent: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "reviewer" }),
		);
		await expect(
			canvas.queryByRole("textbox", { name: "システムプロンプト" }),
		).not.toBeInTheDocument();
	},
};
export const SavingAgent: Story = {
	args: { mode: "saving" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			await canvas.findByRole("textbox", { name: "説明" }),
			" draft",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		await expect(
			canvas.getByRole("textbox", { name: "説明" }),
		).toBeDisabled();
		await expect(
			canvas.getByRole("button", { name: "変更を保存" }),
		).toBeDisabled();
	},
};
export const CodexUnsupportedEffort: Story = {
	args: {
		mode: "codex",
		initialState: {
			agents: [
				{
					...codex,
					edit: {
						...codex.edit,
						model: "limited-model",
						reasoningEffort: "high",
					},
				},
			],
		},
	},
	play: async ({ canvasElement }) => {
		await expect(
			await within(canvasElement).findByRole("alert"),
		).toBeVisible();
	},
};
export const HandoffUnsupportedEffort: Story = {
	args: {
		mode: "codex",
		initialState: {
			handoff: {
				...state.handoff,
				backends: {
					...state.handoff.backends,
					codex: {
						strategy: "fixed",
						model: "limited-model",
						reasoningEffort: "high",
					},
				},
			},
		},
	},
	play: async (context) => {
		await openHandoff(context);
		const canvas = within(context.canvasElement);
		const backend = within(
			canvas.getByRole("region", { name: "codex ハンドオフ" }),
		);
		await expect(backend.getByRole("alert")).toBeVisible();
		await expect(
			backend.getByRole("combobox", { name: "Reasoning effort" }),
		).toHaveValue("high");
	},
};
export const HandoffUnknownModel: Story = {
	args: {
		initialState: {
			handoff: {
				...state.handoff,
				backends: {
					...state.handoff.backends,
					pi: {
						strategy: "fixed",
						model: "offline/provider-model",
						thinking: "high",
					},
				},
			},
		},
	},
	play: openHandoff,
};
export const HandoffNoModels: Story = {
	args: { initialState: { models: { pi: [], codex: [] } } },
	play: openHandoff,
};
export const HandoffSaveError: Story = {
	args: { mode: "conflict" },
	play: async (context) => {
		await openHandoff(context);
		const canvas = within(context.canvasElement);
		await userEvent.type(
			canvas.getByRole("spinbutton", { name: "タイムアウト（秒）" }),
			"1",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "ハンドオフ設定を保存" }),
		);
		await expect(await canvas.findByRole("alert")).toBeVisible();
	},
};
export const UnsavedNavigation: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			await canvas.findByRole("textbox", { name: "説明" }),
			" draft",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "ハンドオフ" }),
		);
		await waitFor(() =>
			expect(
				canvas.getByRole("region", { name: "未保存の変更" }),
			).toBeVisible(),
		);
	},
};

/** 検証対象のハンドオフ設定を開き、入力やエラーを消す操作は続けない。 */
async function openHandoff({ canvasElement }: { canvasElement: HTMLElement }) {
	await userEvent.click(
		await within(canvasElement).findByRole("button", {
			name: "ハンドオフ",
		}),
	);
}
