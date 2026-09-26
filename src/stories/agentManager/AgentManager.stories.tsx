// 通信境界だけを差し替え、実際の管理画面で保存・競合・入力エラーを確認する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentManager } from "../../webview/agentManager/AgentManager";
import { defaultHandoff } from "../../shared/agentManager/config";
import type {
	ManagerBridge,
	ManagerReply,
	ManagerState,
	ManagerRequest,
} from "../../shared/agentManager/messages";

/** 未接続でも既存値が失われない表示用の状態を作る。 */
function sampleState(): ManagerState {
	return {
		type: "state",
		workspace: "workspace-id",
		label: "example-workspace",
		generation: "1",
		agents: [
			{
				id: "pi:reviewer",
				backend: "pi",
				name: "reviewer",
				description: "変更内容と関連テストを確認する Agent。",
				source: "extension",
				aliases: ["review"],
				tools: ["read", "ls"],
				definitionModel: "openai-codex/gpt-6-sol",
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
		],
		piDefaults: {},
		piUserSettings: '{"defaultThinking":"high"}',
		modelScope: "{}",
		handoff: defaultHandoff(),
		handoffExists: false,
		handoffError: null,
		models: {
			pi: [
				{
					value: "openai-codex/gpt-6-sol",
					name: "OpenAI Codex / GPT-6 Sol",
					efforts: ["low", "medium", "high", "ultra"],
				},
				{
					value: "openai-codex/gpt-6-astra",
					name: "GPT-6 Astra",
					efforts: ["low", "medium", "high", "ultra"],
				},
				{
					value: "openai-codex/gpt-5.6-sol",
					name: "GPT-5.6 Sol",
					efforts: ["low", "medium", "high", "ultra"],
				},
				{
					value: "openai-codex/gpt-6-luna",
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
		},
		activeBackend: "pi",
		currentModels: { pi: "openai-codex/gpt-6-sol" },
		running: 1,
		spawned: 3,
		errors: [],
	};
}

/** 保存失敗では世代と入力を保持し、成功時だけ新しい状態を通知する。 */
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

/** Story の再描画で通信状態を作り直さない。 */
function Preview({ mode }: { mode: string }) {
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
