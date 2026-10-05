// 通信境界だけを差し替え、実際の管理画面で保存・競合・入力エラーを確認する。

import { useMemo } from "react";
import { expect, fn, userEvent, within, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentManager } from "../../src/agentManager/AgentManager";
import { defaultHandoff } from "@nerita/shared/agentManager/config";
import type {
	ManagerBridge,
	ManagerReply,
	ManagerState,
	ManagerRequest,
} from "@nerita/shared/agentManager/messages";

/** 未接続でも既存値が失われない表示用の状態を作る。 */
function sampleState(): ManagerState {
	return {
		type: "state",
		workspace: "workspace-id",
		label: "example-workspace",
		generation: "1",
		agents: structuredClone(sampleAgents),
		piDefaults: {},
		piUserSettings: '{"defaultThinking":"high"}',
		modelScope: "{}",
		handoff: defaultHandoff(),
		handoffExists: false,
		handoffError: null,
		models: structuredClone(sampleModels),
		activeBackend: "pi",
		currentModels: { pi: "openai/gpt-6-sol" },
		running: 1,
		spawned: 3,
		errors: [],
	};
}

/** 編集内容をメモリに保持する。競合は固定応答で、保存規則や世代判定は持たない。 */
function mockBridge(
	mode: string,
	onRequest: (message: ManagerRequest) => void,
): ManagerBridge {
	const state = sampleState();
	if (mode === "codex" || mode === "codex-defaults") {
		state.activeBackend = "codex";
	}
	if (mode === "codex-defaults") {
		const agent = state.agents.find((item) => item.backend === "codex")!;
		agent.edit = { definition: agent.edit.definition };
	}
	if (mode === "invalid") {
		state.handoffError = "handoff.json の形式が不正です。";
	}
	if (mode === "empty") {
		state.agents = [];
		state.models = { pi: [], codex: [] };
	}
	const listeners = new Set<(message: ManagerReply) => void>();
	const publish = (message: ManagerReply) =>
		listeners.forEach((listener) => listener(structuredClone(message)));
	const save = (message: Extract<ManagerRequest, { generation: string }>) => {
		if (mode === "conflict") {
			publish({
				type: "reply",
				id: message.id,
				error: "設定が変更されています。再読み込みしてから保存してください。",
				notice: "",
			});
			return;
		}
		if (message.type === "handoff") {
			state.handoff = message.config;
			state.handoffError = null;
			state.handoffExists = true;
		}
		if (message.type === "defaults") {
			state.piDefaults = message.defaults;
		}
		if (message.type === "agent") {
			const agent = state.agents.find(
				(item) => item.id === message.agentId,
			);
			if (agent) {
				agent.edit = message.edit;
				if (message.edit.definition) {
					agent.name = message.edit.definition.name;
					agent.description = message.edit.definition.description;
				}
			}
		}
		state.generation = String(Number(state.generation) + 1);
		publish(state);
		publish({
			type: "reply",
			id: message.id,
			error: null,
			notice: "保存しました。",
		});
	};
	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		postMessage(message) {
			onRequest(message);
			queueMicrotask(() => {
				if (message.type === "ready" || message.type === "reload") {
					publish(state);
				} else if ("generation" in message) {
					save(message);
				}
			});
		},
	};
}

/** 管理画面のストーリーで再現する状態の指定。 */
type PreviewProps = {
	mode: string;
	onRequest: (message: ManagerRequest) => void;
};

/** ストーリーの再描画で通信状態を作り直さない。 */
function Preview({ mode, onRequest }: PreviewProps) {
	const bridge = useMemo(
		() => mockBridge(mode, onRequest),
		[mode, onRequest],
	);
	return <AgentManager bridge={bridge} />;
}
const meta = {
	title: "Agent Manager",
	component: Preview,
	parameters: { layout: "fullscreen" },
	args: { mode: "normal", onRequest: fn() },
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Settings: Story = {};
export const Codex: Story = { args: { mode: "codex" } };
export const CodexDefaults: Story = {
	args: { mode: "codex-defaults" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		await expect(
			await canvas.findByRole("button", { name: "モデルと推論レベル" }),
		).toHaveTextContent("GPT-6.1 Sol Medium");
		await userEvent.click(canvas.getByText("高度な設定", { exact: true }));
		await expect(
			canvas.getByRole("combobox", { name: "承認ポリシー" }),
		).toHaveValue("on-request");
		await expect(
			canvas.queryByRole("option", { name: "未指定" }),
		).not.toBeInTheDocument();
		await userEvent.click(
			canvas.getByRole("button", { name: "サンドボックスモード" }),
		);
		await expect(
			page.getByRole("slider", { name: "サンドボックスモード" }),
		).toHaveAttribute("aria-valuetext", "読み取り専用");
		await expect(
			page.queryByRole("combobox", { name: "承認者" }),
		).not.toBeInTheDocument();
	},
};
export const CodexPermissions: Story = {
	args: { mode: "codex" },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		await expect(
			await canvas.findByRole("button", { name: "モデルと推論レベル" }),
		).toHaveTextContent("GPT-6 Sol High");
		await userEvent.click(canvas.getByText("高度な設定", { exact: true }));
		await userEvent.click(
			canvas.getByRole("button", { name: "サンドボックスモード" }),
		);
		await expect(
			page.queryByRole("combobox", { name: "承認者" }),
		).not.toBeInTheDocument();
		await userEvent.click(
			page.getByRole("button", { name: "サンドボックスモード: 2" }),
		);
		await userEvent.click(
			await page.findByRole("combobox", { name: "承認者" }),
		);
		await userEvent.click(
			await page.findByRole("option", { name: /代わりに承認/ }),
		);
		const slider = page.getByRole("slider", {
			name: "サンドボックスモード",
		});
		await expect(slider).toHaveAttribute(
			"aria-valuetext",
			"ワークスペース内に書き込み",
		);
		await userEvent.keyboard("{Escape}");
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		await expect(args.onRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "agent",
				edit: {
					model: "gpt-6-sol",
					reasoningEffort: "high",
					sandboxMode: "workspace-write",
					approvalsReviewer: "auto_review",
					approvalPolicy: "on-request",
					definition: {
						name: "codex-reviewer",
						description: "Codex の標準定義",
						prompt: "変更内容と関連テストを確認してください。",
					},
				},
			}),
		);
	},
};
export const CodexEditing: Story = {
	args: { mode: "codex" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const name = await canvas.findByRole("textbox", {
			name: "名前",
		});
		await expect(
			canvas.queryByRole("button", { name: "Pi" }),
		).not.toBeInTheDocument();
		await userEvent.clear(name);
		await userEvent.type(name, "updated-reviewer");
		await userEvent.click(canvas.getByText("高度な設定", { exact: true }));
		await userEvent.selectOptions(
			canvas.getByRole("combobox", { name: "承認ポリシー" }),
			"granular",
		);
		await userEvent.click(
			canvas.getByRole("checkbox", { name: "サンドボックス外での実行" }),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		await waitFor(() =>
			expect(canvas.getByRole("status")).toHaveTextContent(
				"保存しました",
			),
		);
		await expect(canvas.getByRole("textbox", { name: "名前" })).toHaveValue(
			"updated-reviewer",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "ハンドオフ" }),
		);
		await expect(
			canvas.getByRole("region", { name: "codex ハンドオフ" }),
		).toBeInTheDocument();
		await expect(
			canvas.queryByRole("region", { name: "pi ハンドオフ" }),
		).not.toBeInTheDocument();
	},
};
export const ApprovalInteractions: Story = {
	args: { mode: "codex" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		const advanced = await canvas.findByRole("button", {
			name: "高度な設定",
		});
		await expect(advanced).toHaveAttribute("aria-expanded", "false");
		await userEvent.click(advanced);
		const policy = canvas.getByRole("combobox", { name: "承認ポリシー" });
		for (const [value, description] of [
			["on-request", "サンドボックス外の実行操作で承認を求める"],
			["never", "承認なし"],
			["granular", "承認の種類ごとに決める"],
		] as const) {
			await userEvent.selectOptions(policy, value);
			await userEvent.hover(policy);
			await expect(await page.findByRole("tooltip")).toHaveTextContent(
				description,
			);
			await userEvent.unhover(policy);
			await userEvent.keyboard("{Escape}");
		}
		const checkbox = canvas.getByRole("checkbox", {
			name: "サンドボックス外での実行",
		});
		await expect(checkbox).toBeChecked();
		await userEvent.click(checkbox);
		await expect(checkbox).not.toBeChecked();
		await userEvent.keyboard(" ");
		await expect(checkbox).toBeChecked();
		await userEvent.click(advanced);
		await expect(canvas.queryByRole("checkbox")).not.toBeInTheDocument();
		await userEvent.click(advanced);
		await expect(checkbox).toBeChecked();
	},
};
export const Conflict: Story = { args: { mode: "conflict" } };
export const Invalid: Story = { args: { mode: "invalid" } };
export const Empty: Story = { args: { mode: "empty" } };

export const NewCodex: Story = {
	args: { mode: "codex" },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await canvas.findByRole("textbox", { name: "名前" });
		await userEvent.click(
			canvas.getByRole("button", { name: "新しいエージェントを追加" }),
		);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "名前" }),
			"new-agent",
		);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "ファイル名" }),
			"new-agent",
		);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "説明" }),
			"新しい説明",
		);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "システムプロンプト" }),
			"テストを確認してください。",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		await expect(args.onRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "createAgent",
				backend: "codex",
				filename: "new-agent",
				edit: {
					model: "gpt-6.1-sol",
					reasoningEffort: "medium",
					sandboxMode: "read-only",
					approvalsReviewer: "user",
					approvalPolicy: "on-request",
					definition: {
						name: "new-agent",
						description: "新しい説明",
						prompt: "テストを確認してください。",
					},
				},
			}),
		);
	},
};

export const UnsavedChanges: Story = {
	args: { mode: "codex" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const name = await canvas.findByRole("textbox", { name: "名前" });
		await userEvent.type(name, "-draft");
		await userEvent.click(
			canvas.getByRole("button", { name: "ハンドオフ" }),
		);
		await expect(
			canvas.getByRole("region", { name: "未保存の変更" }),
		).toBeInTheDocument();
		await userEvent.click(
			canvas.getByRole("button", { name: "編集を続ける" }),
		);
		await expect(name).toHaveValue("codex-reviewer-draft");
		await userEvent.click(
			canvas.getByRole("button", { name: "再読み込み" }),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を破棄" }),
		);
		await waitFor(() =>
			expect(canvas.getByRole("textbox", { name: "名前" })).toHaveValue(
				"codex-reviewer",
			),
		);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "名前" }),
			"-draft",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "ハンドオフ" }),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を破棄" }),
		);
		await expect(
			canvas.getByRole("region", { name: "codex ハンドオフ" }),
		).toBeInTheDocument();
	},
};

export const PiEditing: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await canvas.findByRole("button", { name: "writer" });
		await userEvent.click(canvas.getByRole("button", { name: "writer" }));
		await userEvent.clear(canvas.getByRole("textbox", { name: "名前" }));
		await userEvent.type(
			canvas.getByRole("textbox", { name: "名前" }),
			"updated-writer",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "変更を保存" }),
		);
		await expect(args.onRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "agent",
				agentId: "pi:writer",
				edit: {
					definition: {
						name: "updated-writer",
						description: "プロジェクトの Agent",
						prompt: "文書を編集してください。",
					},
				},
			}),
		);
	},
};

/** ストーリー間で編集内容を共有しないため、使用時に複製する。 */
const sampleAgents: ManagerState["agents"] = [
	{
		id: "pi:writer",
		backend: "pi",
		name: "writer",
		description: "プロジェクトの Agent",
		source: "project",
		definitionPath: ".pi/agents/writer.md",
		aliases: [],
		tools: [],
		editable: true,
		edit: {
			definition: {
				name: "writer",
				description: "プロジェクトの Agent",
				prompt: "文書を編集してください。",
			},
		},
	},
	{
		id: "pi:reviewer",
		backend: "pi",
		name: "reviewer",
		description: "変更内容と関連テストを確認する Agent。",
		source: "extension",
		aliases: ["review"],
		tools: ["read", "ls"],
		definitionModel: "openai/gpt-6-sol",
		definitionThinking: "high",
		edit: {},
		editable: true,
	},
	{
		id: "pi:unsupported",
		backend: "pi",
		name: "external-runner",
		description: "外部実行の定義",
		source: "user",
		aliases: [],
		tools: [],
		edit: { disabled: true },
		editable: true,
		unavailableReason: "外部 runner は Nerita では非対応です。",
	},
	{
		id: ".codex/agents/reviewer.toml",
		definitionPath: ".codex/agents/reviewer.toml",
		backend: "codex",
		name: "codex-reviewer",
		description: "Codex の標準定義",
		source: "project",
		aliases: [],
		tools: [],
		edit: {
			model: "gpt-6-sol",
			reasoningEffort: "high",
			definition: {
				name: "codex-reviewer",
				description: "Codex の標準定義",
				prompt: "変更内容と関連テストを確認してください。",
			},
		},
		definitionModel: "gpt-6-sol",
		definitionThinking: "high",
		editable: true,
	},
];

/** バックエンドごとの選択可能なモデルを示す固定データ。 */
const sampleModels: ManagerState["models"] = {
	pi: [
		{
			value: "openai/gpt-6-sol",
			name: "OpenAI / GPT-6 Sol",
			efforts: ["low", "medium", "high", "max"],
		},
		{
			value: "openai/gpt-6-astra",
			name: "GPT-6 Astra",
			efforts: ["low", "medium", "high", "max"],
		},
		{
			value: "openai/gpt-5.6-sol",
			name: "GPT-5.6 Sol",
			efforts: ["low", "medium", "high", "max"],
		},
		{
			value: "openai/gpt-6-luna",
			name: "GPT-6 Luna",
			efforts: ["low", "medium", "high"],
		},
	],
	codex: [
		{
			value: "gpt-6.1-sol",
			name: "GPT-6.1 Sol",
			efforts: ["low", "medium", "high", "ultra"],
		},
		{
			value: "gpt-6-sol",
			name: "GPT-6 Sol",
			efforts: ["low", "medium", "high", "ultra"],
		},
		{
			value: "gpt-6-astra",
			name: "GPT-6 Astra",
			efforts: ["low", "medium", "high", "ultra"],
		},
		{
			value: "gpt-5.6-sol",
			name: "GPT-5.6 Sol",
			efforts: ["low", "medium", "high", "ultra"],
		},
		{
			value: "gpt-6-luna",
			name: "GPT-6 Luna",
			efforts: ["low", "medium", "high"],
		},
		{
			value: "limited-model",
			name: "Limited model",
			efforts: ["low"],
		},
	],
};
