// 通信境界だけを差し替え、実際の管理画面で保存・競合・入力エラーを確認する。

import { useMemo } from "react";
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
function mockBridge(mode: string): ManagerBridge {
	const state = sampleState();
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
			}
		}
		state.generation = "saved-fixture";
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
type PreviewProps = { mode: string };

/** ストーリーの再描画で通信状態を作り直さない。 */
function Preview({ mode }: PreviewProps) {
	const bridge = useMemo(() => mockBridge(mode), [mode]);
	return <AgentManager bridge={bridge} />;
}
const meta = {
	title: "Agent Manager",
	component: Preview,
	parameters: { layout: "fullscreen" },
	args: { mode: "normal" },
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Settings: Story = {};
export const Conflict: Story = { args: { mode: "conflict" } };
export const Invalid: Story = { args: { mode: "invalid" } };
export const Empty: Story = { args: { mode: "empty" } };

/** ストーリー間で編集内容を共有しないため、使用時に複製する。 */
const sampleAgents: ManagerState["agents"] = [
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
		backend: "codex",
		name: "codex-reviewer",
		description: "Codex の標準定義",
		source: "project",
		aliases: [],
		tools: [],
		edit: { model: "gpt-6-sol", reasoningEffort: "high" },
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
