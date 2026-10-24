// 管理画面のストーリーで、通信境界と固定の保存応答を用意する。
import { defaultHandoff } from "@nerita/shared/agentManager/config";
import type {
	ManagerBridge,
	ManagerReply,
	ManagerState,
	ManagerRequest,
} from "@nerita/shared/agentManager/messages";
/** 未接続でも既存値が失われない表示用の状態を作る。 */
export function sampleState(): ManagerState {
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
		currentModels: { pi: "openai/gpt-6-sol", codex: "gpt-6-sol" },
		currentEfforts: {
			pi: ["low", "medium", "high", "max"],
			codex: ["low", "medium", "high", "ultra"],
		},
		running: 1,
		spawned: 3,
		errors: [],
	};
}

/** 各エラーやバックエンドの初期状態を、ストーリーごとに独立して用意する。 */
function storyState(mode: string): ManagerState {
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
	if (mode === "load-errors") {
		state.errors = [
			"エージェント定義の読み込みに失敗しました: .pi/agents/broken.md",
			"モデル一覧を取得できませんでした。接続を確認して再読み込みしてください。",
		];
	}
	return state;
}

/** 編集内容をメモリに保持する。競合は固定応答で、保存規則や世代判定は持たない。 */
export function mockBridge(
	mode: string,
	onRequest: (message: ManagerRequest) => void,
	initialState?: Partial<ManagerState>,
): ManagerBridge & { update: (patch: Partial<ManagerState>) => void } {
	const state = { ...storyState(mode), ...structuredClone(initialState) };
	const listeners = new Set<(message: ManagerReply) => void>();
	const publish = (message: ManagerReply) =>
		listeners.forEach((listener) => listener(structuredClone(message)));
	const save = (message: Extract<ManagerRequest, { generation: string }>) => {
		if (mode === "saving") {
			return;
		}
		if (["conflict", "validation-error", "reload-failure"].includes(mode)) {
			publish({
				type: "reply",
				id: message.id,
				error:
					mode === "validation-error"
						? "同名の Agent が存在します。"
						: "設定が変更されています。再読み込みしてから保存してください。",
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
			applyAgentEdit(state, message);
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
		/** Host の候補更新を保存応答と分け、編集を続けている画面へ通知する。 */
		update(patch) {
			Object.assign(state, structuredClone(patch));
			publish(state);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		postMessage(message) {
			onRequest(message);
			queueMicrotask(() => {
				if (message.type === "draft") {
					publishDraftReply(mode, message, state, publish);
				} else if (
					message.type === "ready" ||
					message.type === "reload"
				) {
					publishInitialState(mode, message.type, state, publish);
				} else if ("generation" in message) {
					save(message);
				}
			});
		},
	};
}
/** 退避の失敗は設定保存とは独立して再現し、再読み込みを続けないことを検証できるようにする。 */
function publishDraftReply(
	mode: string,
	message: Extract<ManagerRequest, { type: "draft" }>,
	state: ManagerState,
	publish: (message: ManagerReply) => void,
) {
	if (mode === "draft-write-error") {
		publish({
			type: "reply",
			id: message.id,
			error: "下書きファイルを保存できません。",
			notice: "",
		});
		return;
	}
	state.draft = message.draft;
	state.draftError = null;
	publish({
		type: "reply",
		id: message.id,
		error: null,
		notice: "下書きを保存しました。",
	});
}

/** 初回だけの取得失敗と、再読み込みによる復旧・接続先変更を通信境界で再現する。 */
function publishInitialState(
	mode: string,
	type: "ready" | "reload",
	state: ManagerState,
	publish: (message: ManagerReply) => void,
) {
	if (mode === "reload-failure" && type === "reload") {
		publish({
			type: "reply",
			id: 0,
			error: "設定を読み込めませんでした。",
			notice: "",
		});
		return;
	}
	if (mode === "initialization-error" && type === "ready") {
		publish({
			type: "reply",
			id: 0,
			error: "管理画面の初期化に失敗しました。再読み込みしてください。",
			notice: "",
		});
		return;
	}
	if (mode === "backend-switch" && type === "reload") {
		state.activeBackend = state.activeBackend === "pi" ? "codex" : "pi";
	}
	publish(state);
}

/** 名前変更後の ID も含め、保存後の表示用スナップショットへ編集値を反映する。 */
function applyAgentEdit(
	state: ManagerState,
	message: Extract<ManagerRequest, { type: "agent" }>,
) {
	const agent = state.agents.find((item) => item.id === message.agentId);
	if (!agent) {
		return;
	}
	agent.edit = message.edit;
	const definition = message.edit.definition;
	if (!definition) {
		return;
	}
	agent.name = definition.name;
	agent.description = definition.description;
	if (agent.backend === "pi") {
		agent.id = `pi:${definition.name}`;
	}
}

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
		unavailableReason: "外部ランナーは Nerita では非対応です。",
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
