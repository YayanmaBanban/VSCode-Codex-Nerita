// 途中で修正・保存せず、条件付きの警告や入力制約を目視確認できる状態で保持する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, fn, userEvent, within, waitFor } from "storybook/test";
import Preview from "./AgentManagerPreview.svelte";
import { sampleState } from "./managerStoryBridge";
import type { ManagedAgent } from "@nerita/shared/agentManager/messages";

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

export const ManyPiAgents: Story = {
	args: { initialState: { agents: manyAgents("pi") } },
	play: verifyManyAgents,
};
export const ManyCodexAgents: Story = {
	args: { mode: "codex", initialState: { agents: manyAgents("codex") } },
	play: verifyManyAgents,
};

export const TooltipDismissedOnScroll: Story = {
	args: { initialState: { agents: manyAgents("pi") } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const list = await canvas.findByRole("region", {
			name: "エージェント一覧",
		});
		const first = within(list).getByRole("button", { name: "agent-001" });
		await userEvent.hover(first);
		const page = within(canvasElement.ownerDocument.body);
		await expect(await page.findByRole("tooltip")).toHaveTextContent(
			"agent-001 の説明",
		);
		const scrolled = new Promise<Event>((resolve) =>
			list.addEventListener("scrollend", resolve, { once: true }),
		);
		list.scrollTop = 300;
		await waitFor(() =>
			expect(page.queryByRole("tooltip")).not.toBeInTheDocument(),
		);
		await userEvent.unhover(first);
		await scrolled;
		const next = within(list).getByRole("button", { name: "agent-012" });
		await userEvent.hover(next);
		await expect(await page.findByRole("tooltip")).toHaveTextContent(
			"agent-012 の説明",
		);
		list.scrollTop = 500;
		await waitFor(() =>
			expect(page.queryByRole("tooltip")).not.toBeInTheDocument(),
		);
	},
};

export const AgentSearch: Story = {
	args: { initialState: { agents: manyAgents("pi") } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const list = within(
			await canvas.findByRole("navigation", { name: "Agents" }),
		);
		await userEvent.type(
			canvas.getByRole("searchbox", { name: "エージェントを検索" }),
			"AGENT-007",
		);
		await expect(
			list.queryByRole("button", { name: "agent-001" }),
		).not.toBeInTheDocument();
		await expect(
			list.getByRole("button", { name: "Workspace defaults" }),
		).toBeVisible();
		await userEvent.click(list.getByRole("button", { name: "agent-007" }));
		await expect(
			list.getByRole("button", { name: "agent-007" }),
		).toHaveAttribute("aria-current", "page");
		await expect(canvas.getByRole("textbox", { name: "名前" })).toHaveValue(
			"agent-007",
		);
	},
};

export const SelectedAgent: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByRole("region", { name: "選択中のエージェント" }),
		).toHaveTextContent("writer");
		await userEvent.click(
			canvas.getByRole("button", { name: "Workspace defaults" }),
		);
		await waitFor(() =>
			expect(
				canvas.queryByRole("region", { name: "選択中のエージェント" }),
			).not.toBeInTheDocument(),
		);
		await userEvent.click(canvas.getByRole("button", { name: "reviewer" }));
		await expect(
			canvas.getByRole("region", { name: "選択中のエージェント" }),
		).toHaveTextContent("reviewer");
	},
};

export const DefaultsUnsavedNavigation: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "Workspace defaults" }),
		);
		const limit = canvas.getByRole("spinbutton", {
			name: "セッション内の起動上限",
		});
		await userEvent.clear(limit);
		await userEvent.type(limit, "3");
		await userEvent.click(canvas.getByRole("button", { name: "writer" }));
		const footer = canvas.getByRole("region", { name: "未保存の変更" });
		await expect(footer).toHaveTextContent(
			"未保存の変更を破棄して移動しますか？",
		);
		await expect(
			within(footer).getByRole("button", { name: "変更を保存" }),
		).toBeEnabled();
		await expect(
			within(footer).getByRole("button", { name: "変更を破棄" }),
		).toBeEnabled();
	},
};

export const InvalidUnsavedNavigation: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.clear(
			await canvas.findByRole("textbox", { name: "名前" }),
		);
		await userEvent.click(canvas.getByRole("button", { name: "reviewer" }));
		const footer = canvas.getByRole("region", { name: "未保存の変更" });
		await expect(
			within(footer).getByRole("button", { name: "変更を保存" }),
		).toBeDisabled();
		await expect(
			within(footer).getByRole("button", { name: "変更を破棄" }),
		).toBeEnabled();
	},
};

export const AgentSearchNoResults: Story = {
	args: { initialState: { agents: manyAgents("pi") } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			await canvas.findByRole("searchbox", {
				name: "エージェントを検索",
			}),
			"not-found",
		);
		const list = within(canvas.getByRole("navigation", { name: "Agents" }));
		await expect(list.getAllByRole("button")).toHaveLength(1);
		await userEvent.click(
			list.getByRole("button", { name: "Workspace defaults" }),
		);
		await expect(
			list.getByRole("button", { name: "Workspace defaults" }),
		).toHaveAttribute("aria-current", "page");
		await expect(canvas.getByRole("searchbox")).toHaveValue("not-found");
	},
};

/** 実際の編集画面を開ける定義を 100 件用意する。 */
function manyAgents(backend: ManagedAgent["backend"]): ManagedAgent[] {
	const template = state.agents.find((agent) => agent.backend === backend)!;
	return Array.from({ length: 100 }, (_, index) => {
		const name = `agent-${String(index + 1).padStart(3, "0")}`;
		const definitionPath =
			backend === "pi"
				? `.pi/agents/${name}.md`
				: `.codex/agents/${name}.toml`;
		return {
			...structuredClone(template),
			id: backend === "pi" ? `pi:${name}` : definitionPath,
			definitionPath,
			name,
			description: `${name} の説明`,
			edit: {
				...template.edit,
				definition: {
					...template.edit.definition!,
					name,
					description: `${name} の説明`,
				},
			},
		};
	});
}

/** 一覧の末尾と先頭を選べることを確かめ、目視確認用に先頭の状態へ戻す。 */
async function verifyManyAgents({
	canvasElement,
}: {
	canvasElement: HTMLElement;
}) {
	const canvas = within(canvasElement);
	const list = within(
		await canvas.findByRole("navigation", { name: "Agents" }),
	);
	await expect(
		list
			.getAllByRole("button")
			.filter((button) => button.textContent.includes("agent-")),
	).toHaveLength(100);
	for (const name of ["agent-100", "agent-001"]) {
		const button = list.getByRole("button", { name });
		button.scrollIntoView({ block: "center" });
		await userEvent.click(button);
		await expect(button).toHaveAttribute("aria-current", "page");
		await expect(canvas.getByRole("textbox", { name: "名前" })).toHaveValue(
			name,
		);
	}
	canvasElement.ownerDocument.defaultView?.scrollTo(0, 0);
}

export const InvalidName: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.clear(
			await canvas.findByRole("textbox", { name: "名前" }),
		);
		await expect(canvas.getByRole("alert")).toBeVisible();
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"名前が空欄です。",
		);
		await expect(
			canvas.getByRole("textbox", { name: "名前" }),
		).toHaveAttribute("aria-invalid", "true");
		await expect(
			canvas.getByRole("textbox", { name: "名前" }),
		).toHaveAccessibleDescription("名前が空欄です。");
		await expect(
			canvas.getByRole("button", { name: "変更を保存" }),
		).toBeDisabled();
	},
};

export const WhitespaceName: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const name = await canvas.findByRole("textbox", { name: "名前" });
		await userEvent.clear(name);
		await userEvent.type(name, "   ");
		await expect(name).toHaveAccessibleDescription("名前が空欄です。");
	},
};

export const DefinitionTooLong: Story = {
	args: {
		initialState: {
			agents: [
				{
					...state.agents[0]!,
					edit: {
						...state.agents[0]!.edit,
						definition: {
							name: "a".repeat(81),
							description: "説明".repeat(1001),
							prompt: "指示".repeat(30001),
						},
					},
				},
			],
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByRole("textbox", { name: "名前" }),
		).toHaveAccessibleDescription("名前は80文字以内で入力してください。");
		await expect(
			canvas.getByRole("textbox", { name: "説明" }),
		).toHaveAccessibleDescription("説明は2000文字以内で入力してください。");
		await expect(
			canvas.getByRole("textbox", { name: "システムプロンプト" }),
		).toHaveAccessibleDescription(
			"システムプロンプトは60000文字以内で入力してください。",
		);
	},
};

export const InvalidFilename: Story = {
	args: { mode: "codex" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", {
				name: "新しいエージェントを追加",
			}),
		);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "名前" }),
			"reviewer",
		);
		const filename = canvas.getByRole("textbox", { name: "ファイル名" });
		await userEvent.type(filename, "reviewer.toml");
		await expect(filename).toHaveAttribute("aria-invalid", "true");
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"拡張子は不要です",
		);
		await expect(
			canvas.getByRole("button", { name: "変更を保存" }),
		).toBeDisabled();
	},
};

export const ValidationRecovered: Story = {
	args: { mode: "codex" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", {
				name: "新しいエージェントを追加",
			}),
		);
		await expect(canvas.getAllByRole("alert")).toHaveLength(2);
		const name = canvas.getByRole("textbox", { name: "名前" });
		const filename = canvas.getByRole("textbox", { name: "ファイル名" });
		await userEvent.type(name, "reviewer");
		await expect(name).not.toHaveAttribute("aria-invalid");
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"ファイル名が空欄です。",
		);
		await expect(
			canvas.getByRole("button", { name: "変更を保存" }),
		).toBeDisabled();
		await userEvent.type(filename, "reviewer");
		await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
		await expect(filename).not.toHaveAttribute("aria-invalid");
		await expect(filename).not.toHaveAttribute("aria-describedby");
		await expect(
			canvas.getByRole("button", { name: "変更を保存" }),
		).toBeEnabled();
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
			backend.getByRole("combobox", { name: "推論レベル" }),
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
		const timeout = canvas.getByRole("spinbutton", {
			name: "タイムアウト（秒）",
		});
		await userEvent.clear(timeout);
		await userEvent.type(timeout, "121");
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		await expect(await canvas.findByRole("alert")).toBeVisible();
	},
};

export const HandoffTimeoutOutOfRange: Story = {
	play: async (context) => {
		await openHandoff(context);
		const canvas = within(context.canvasElement);
		const timeout = canvas.getByRole("spinbutton", {
			name: "タイムアウト（秒）",
		});
		await userEvent.clear(timeout);
		await userEvent.type(timeout, "601");
		await expect(timeout).toHaveAttribute("aria-invalid", "true");
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"タイムアウトは1〜600秒の範囲で入力してください。",
		);
		await expect(
			canvas.getByRole("button", { name: "変更を保存" }),
		).toBeDisabled();
	},
};

export const HandoffTimeoutDecimal: Story = {
	play: async (context) => {
		await openHandoff(context);
		const canvas = within(context.canvasElement);
		const timeout = canvas.getByRole("spinbutton", {
			name: "タイムアウト（秒）",
		});
		await userEvent.clear(timeout);
		await userEvent.type(timeout, "1.5");
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"タイムアウトは整数で入力してください。",
		);
		await expect(
			canvas.getByRole("button", { name: "変更を保存" }),
		).toBeDisabled();
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
