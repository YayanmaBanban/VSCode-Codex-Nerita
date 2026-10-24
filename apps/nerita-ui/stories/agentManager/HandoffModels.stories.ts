// 現在セッションの推論候補と、固定モデルへの切替時の初期値を実際の管理画面で確認する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, fn, userEvent, within, waitFor } from "storybook/test";
import Preview from "./AgentManagerPreview.svelte";
import { sampleState } from "./managerStoryBridge";
import { runtimeDiagnostics } from "../runtimeDiagnostics";
import type {
	ManagerRequest,
	ManagerState,
} from "@nerita/shared/agentManager/messages";

const state = sampleState();
const meta = {
	...runtimeDiagnostics(),
	title: "Agent Manager/Handoff Models",
	component: Preview,
	parameters: { layout: "fullscreen" },
	args: {
		mode: "normal",
		onRequest: fn<(message: ManagerRequest) => void>(),
	},
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<{
	mode: string;
	initialState?: Partial<ManagerState>;
	onConnect?: ReturnType<
		typeof fn<(update: (patch: Partial<ManagerState>) => void) => void>
	>;
	onRequest: ReturnType<typeof fn<(message: ManagerRequest) => void>>;
}>;

export const ModelUpdateWhileEditing: Story = {
	args: {
		onConnect:
			fn<(update: (patch: Partial<ManagerState>) => void) => void>(),
		initialState: {
			agents: state.agents.map((agent) =>
				agent.id === "pi:writer"
					? {
							...agent,
							edit: {
								...agent.edit,
								model: "openai/gpt-6-luna",
								thinking: "high",
							},
						}
					: agent,
			),
		},
	},
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const description = await canvas.findByRole("textbox", {
			name: "説明",
		});
		await userEvent.type(description, " draft");
		const update = args.onConnect?.mock.calls.at(-1)?.[0];
		if (!update) {
			throw new Error("候補更新用の接続がありません。");
		}
		update({
			models: {
				...state.models,
				pi: state.models.pi.map((model) =>
					model.value === "openai/gpt-6-luna"
						? { ...model, name: "更新後のモデル" }
						: model,
				),
			},
		});
		await waitFor(() =>
			expect(
				canvas.getByRole("button", { name: "モデルと推論レベル" }),
			).toHaveTextContent("更新後のモデル High"),
		);
		await expect(canvas.getByRole("textbox", { name: "説明" })).toHaveValue(
			"プロジェクトの Agent draft",
		);
		await expect(
			canvasElement.querySelector("footer .lucide-badge-alert"),
		).toBeInTheDocument();
	},
};

export const PiUnspecifiedModel: Story = {
	args: {
		initialState: {
			agents: state.agents.map((agent) =>
				agent.id === "pi:writer"
					? {
							...agent,
							edit: {
								...agent.edit,
								model: "openai/gpt-6-luna",
								thinking: "high",
							},
						}
					: agent,
			),
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		const trigger = await canvas.findByRole("button", {
			name: "モデルと推論レベル",
		});
		await expect(trigger).toHaveTextContent("GPT-6 Luna High");
		await userEvent.click(trigger);
		await userEvent.click(page.getByRole("combobox", { name: "モデル" }));
		await userEvent.click(page.getByRole("option", { name: "未指定" }));
		await expect(trigger).toHaveTextContent("未指定 未指定");
		await expect(trigger).not.toHaveTextContent("保存済み");
		await userEvent.keyboard("{Escape}");
		await userEvent.hover(trigger);
		await new Promise((resolve) => setTimeout(resolve, 200));
		await expect(page.queryByRole("tooltip")).not.toBeInTheDocument();
	},
};

export const CodexCurrent: Story = {
	args: {
		mode: "codex",
		initialState: {
			currentModels: { codex: "session-alias" },
			currentEfforts: { codex: ["low", "medium", "high"] },
		},
	},
	play: async (context) => {
		const canvas = await openHandoff(context);
		const effort = canvas.getByRole("combobox", {
			name: "推論レベル",
		});
		const page = within(context.canvasElement.ownerDocument.body);
		await userEvent.click(effort);
		await expect(page.getAllByRole("option")).toHaveLength(4);
		await userEvent.click(page.getByRole("option", { name: "High" }));
		await userEvent.click(effort);
		await userEvent.click(page.getByRole("option", { name: /^未指定/ }));
		await userEvent.click(effort);
		await expect(
			page.getByRole("option", { selected: true }),
		).toHaveAttribute("data-value", "");
		await userEvent.click(page.getByRole("option", { name: "High" }));
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		const saved = context.args.onRequest.mock.calls.find(
			([request]) => request.type === "handoff",
		)?.[0];
		if (saved?.type !== "handoff") {
			throw new Error("ハンドオフの保存要求がありません。");
		}
		await expect(saved.config.backends.codex).toEqual({
			strategy: "current",
			reasoningEffort: "high",
		});
	},
};
export const PiCurrent: Story = {
	args: {
		initialState: {
			currentModels: { pi: "provider/current-alias" },
			currentEfforts: { pi: ["off", "low", "high"] },
		},
	},
	play: async (context) => {
		const canvas = await openHandoff(context);
		const effort = canvas.getByRole("combobox", { name: "推論レベル" });
		const page = within(context.canvasElement.ownerDocument.body);
		await userEvent.click(effort);
		await expect(page.getAllByRole("option")).toHaveLength(4);
		await userEvent.click(page.getByRole("option", { name: "High" }));
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		const saved = context.args.onRequest.mock.calls.find(
			([request]) => request.type === "handoff",
		)?.[0];
		if (saved?.type !== "handoff") {
			throw new Error("ハンドオフの保存要求がありません。");
		}
		await expect(saved.config.backends.pi).toEqual({
			strategy: "current",
			thinking: "high",
		});
	},
};
export const CodexFixed: Story = {
	args: { mode: "codex" },
	play: (context) => verifyFixed(context, "codex", "gpt-6-luna"),
};
export const PiFixed: Story = {
	args: {
		initialState: {
			models: {
				...state.models,
				pi: [
					{
						value: "anthropic/available-model",
						name: "Anthropic / 利用可能なモデル",
						efforts: ["low", "high"],
					},
					...state.models.pi,
				],
			},
		},
	},
	play: (context) => verifyFixed(context, "pi", "openai/gpt-6-luna"),
};
export const PiWithoutPreferredModel: Story = {
	args: {
		initialState: {
			models: {
				...state.models,
				pi: [
					{
						value: "anthropic/available-model",
						name: "Anthropic / 利用可能なモデル",
						efforts: ["low", "high"],
					},
				],
			},
		},
	},
	play: (context) => verifyFixed(context, "pi", "anthropic/available-model"),
};
export const NoModels: Story = {
	args: { initialState: { models: { pi: [], codex: [] } } },
	play: async (context) => {
		const canvas = await openHandoff(context);
		const mode = canvas.getByRole("combobox", {
			name: "モデル選択のモード",
		});
		await userEvent.click(mode);
		await expect(
			within(context.canvasElement.ownerDocument.body).getByRole(
				"option",
				{ name: "モデルを固定する" },
			),
		).toHaveAttribute("aria-disabled", "true");
		await userEvent.keyboard("{Escape}");
		await expect(mode).toHaveTextContent("現在のセッションのモデルを使用");
	},
};
export const CurrentUnavailable: Story = {
	args: { initialState: { currentModels: {}, currentEfforts: {} } },
	play: async (context) => {
		const canvas = await openHandoff(context);
		await expect(
			canvas.getByText(/現在のセッションの推論レベルを取得できません/),
		).toBeVisible();
	},
};

/** 対象の初期状態を残したハンドオフ画面を開く。 */
async function openHandoff({ canvasElement }: { canvasElement: HTMLElement }) {
	const canvas = within(canvasElement);
	await userEvent.click(
		await canvas.findByRole("button", { name: "ハンドオフ" }),
	);
	return canvas;
}

/** 空の選択肢や未確認の警告を経由せず、利用可能な固定モデルが選択されることを確認する。 */
async function verifyFixed(
	context: { canvasElement: HTMLElement },
	backend: "pi" | "codex",
	expected: string,
) {
	const canvas = await openHandoff(context);
	const section = within(
		canvas.getByRole("region", { name: `${backend} ハンドオフ` }),
	);
	await userEvent.click(
		section.getByRole("combobox", { name: "モデル選択のモード" }),
	);
	await userEvent.click(
		within(context.canvasElement.ownerDocument.body).getByRole("option", {
			name: "モデルを固定する",
		}),
	);
	const model = section.getByRole("combobox", { name: "モデル" });
	await userEvent.click(model);
	const page = within(context.canvasElement.ownerDocument.body);
	await expect(page.getByRole("option", { selected: true })).toHaveAttribute(
		"data-value",
		expected,
	);
	await expect(
		page.queryByRole("option", { name: "モデルを選択" }),
	).not.toBeInTheDocument();
	await userEvent.keyboard("{Escape}");
	await expect(
		canvas.queryByText(/確認できません|取得できません/),
	).not.toBeInTheDocument();
	await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
}
