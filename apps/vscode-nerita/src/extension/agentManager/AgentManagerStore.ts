// 読み取った世代を照合し、設定ごとの保存先へ必要なキーだけを書き込む。
import {
	applyEdits,
	modify,
	parseTree,
	findNodeAtLocation,
	getNodeValue,
} from "jsonc-parser";
import {
	agentEditSchema,
	type AgentEdit,
	handoffSchema,
	defaultHandoff,
	piDefaultsSchema,
} from "@nerita/shared/agentManager/config";
import {
	managerRequestSchema,
	type ManagedAgent,
	type ManagerModel,
	type ManagerRequest,
} from "@nerita/shared/agentManager/messages";
import { codexAgentFiles } from "./CodexAgentFiles";
import { editCodexAgent } from "./CodexAgentEdit";
import { editPiAgent, assertPiEdit } from "./PiAgentEdit";
import {
	generation,
	readWorkspaceFile,
	serialized,
	writeWorkspaceFile,
} from "./WorkspaceFiles";
import { piSettings, type readPiAgents } from "./PiAgentSettings";
import {
	effortError,
	handoffEffortError,
} from "@nerita/shared/agentManager/effort";

export type PiAgentReader = () => Promise<
	Awaited<ReturnType<typeof readPiAgents>>
>;
export type ManagerMutation = Extract<ManagerRequest, { generation: string }>;

/** 保存時点のモデル候補で、新しく指定したモデルと推論レベルを検証する。 */
export class AgentManagerStore {
	constructor(
		readonly root: string,
		private pi: PiAgentReader,
		private models: (backend: "pi" | "codex") => ManagerModel[],
		private activeBackend?: () => "pi" | "codex",
	) {}
	async read() {
		const errors: string[] = [];
		const read = async (file: string) => {
			try {
				return await readWorkspaceFile(this.root, file);
			} catch (error) {
				errors.push(`${file}: ${String(error)}`);
				return undefined;
			}
		};
		const piText =
			this.activeBackend?.() === "codex"
				? undefined
				: await read(".pi/settings.json");
		const handoffText = await read(".nerita/handoff.json");
		const codex = await this.readCodex().catch((error: unknown) => {
			errors.push(String(error));
			return { agents: [], files: {}, errors: [] };
		});
		const pi = await this.readPi().catch((error: unknown) => {
			const files: Record<string, string> = {};
			errors.push(`Pi: ${String(error)}`);
			return {
				files,
				agents: [],
				defaults: {},
				userSettings: "{}",
				modelScope: "{}",
				fingerprint: String(error),
			};
		});
		let handoff = defaultHandoff();
		let handoffError: string | null = null;
		try {
			if (handoffText !== undefined) {
				const value: unknown = JSON.parse(handoffText);
				// 以前の管理画面が付けた相対参照は、次回保存時に除去する。
				if (
					typeof value === "object" &&
					value !== null &&
					"$schema" in value &&
					value.$schema === "./handoff.schema.json"
				) {
					delete value.$schema;
				}
				handoff = handoffSchema.parse(value);
			}
		} catch (error) {
			handoffError = `handoff.json の形式が不正です: ${String(error)}`;
		}
		const agents: ManagedAgent[] = [...pi.agents, ...codex.agents];
		return {
			agents,
			piDefaults: pi.defaults,
			piUserSettings: pi.userSettings,
			modelScope: pi.modelScope,
			handoff,
			handoffExists: handoffText !== undefined,
			handoffError,
			errors: [...errors, ...codex.errors],
			generation: generation({
				piText,
				handoffText,
				codex: codex.files,
				pi: pi.fingerprint,
				piAgents: pi.files,
				errors,
				codexErrors: codex.errors,
			}),
			files: {
				piAgents: pi.files,
				piText,
				handoffText,
				codex: codex.files as Record<string, string>,
			},
		};
	}

	/** Codex の画面を開くために Pi SDK を起動しない。 */
	private readPi(): ReturnType<PiAgentReader> {
		if (this.activeBackend?.() === "codex") {
			return Promise.resolve({
				agents: [],
				files: {},
				defaults: {},
				userSettings: "{}",
				modelScope: "{}",
				fingerprint: "",
			});
		}
		return this.pi();
	}

	/** Pi の画面には Codex 定義の読込みエラーを混ぜない。 */
	private readCodex(): ReturnType<typeof codexAgentFiles> {
		if (this.activeBackend?.() === "pi") {
			return Promise.resolve({ agents: [], files: {}, errors: [] });
		}
		return codexAgentFiles(this.root);
	}

	/** 古い画面や外部編集との競合は、書き込む前にエラーとして返す。 */
	save(request: ManagerMutation, assertWritable: () => void = () => {}) {
		return serialized(this.root, async () => {
			managerRequestSchema.parse(request);
			assertWritable();
			const state = await this.read();
			if (request.generation !== state.generation) {
				throw new Error(
					"設定が変更されています。再読み込みしてから保存してください。",
				);
			}
			assertWritable();
			if (request.type === "createAgent") {
				await this.createAgent(request, state);
				return;
			}
			if (request.type === "handoff") {
				const config = handoffSchema.parse(request.config);
				const other = request.backend === "pi" ? "codex" : "pi";
				config.backends = {
					...config.backends,
					[other]: state.handoff.backends[other],
				};
				const error = handoffEffortError(
					config,
					state.handoff,
					{
						pi: this.models("pi"),
						codex: this.models("codex"),
					},
					request.backend,
				);
				if (error) {
					throw new Error(error);
				}
				await writeWorkspaceFile(
					this.root,
					".nerita/handoff.json",
					state.files.handoffText,
					`${JSON.stringify(config, null, 2)}\n`,
				);
				return;
			}
			if (request.type === "defaults") {
				const defaults = piDefaultsSchema.parse(request.defaults);
				const old = piSettings(state.files.piText);
				this.validateEffort(
					"pi",
					defaults.defaultModel,
					defaults.defaultThinking,
					old.defaultModel,
					old.defaultThinking,
				);
				this.validateModel(
					"pi",
					defaults.defaultModel,
					old.defaultModel,
				);
				let text = state.files.piText ?? "{}\n";
				for (const key of Object.keys(
					piDefaultsSchema.shape,
				) as (keyof typeof defaults)[]) {
					text = editJson(text, ["subagents", key], defaults[key]);
				}
				await writeWorkspaceFile(
					this.root,
					".pi/settings.json",
					state.files.piText,
					text,
				);
				return;
			}
			await this.saveAgent(request, state);
		});
	}

	/** 新規作成は既存ファイルと同名の定義を上書きしない。 */
	private async createAgent(
		request: Extract<ManagerMutation, { type: "createAgent" }>,
		state: Awaited<ReturnType<AgentManagerStore["read"]>>,
	) {
		const edit = agentEditSchema.parse(request.edit);
		if (!edit.definition) {
			throw new Error("Agent 定義を入力してください。");
		}
		this.assertUniqueName(
			state.agents,
			request.backend,
			edit.definition.name,
		);
		this.validateModel(request.backend, edit.model);
		this.validateEffort(
			request.backend,
			edit.model,
			request.backend === "pi" ? edit.thinking : edit.reasoningEffort,
		);
		const file =
			request.backend === "codex"
				? `.codex/agents/${request.filename}.toml`
				: `.pi/agents/${request.filename}.md`;
		const text =
			request.backend === "codex"
				? editCodexAgent("", edit)
				: editPiAgent(undefined, edit);
		await writeWorkspaceFile(this.root, file, undefined, text);
	}

	/** 保存するバックエンドに応じて、定義と上書き設定の書込み先を分ける。 */
	private async saveAgent(
		request: Extract<ManagerMutation, { type: "agent" }>,
		state: Awaited<ReturnType<AgentManagerStore["read"]>>,
	) {
		const agent = state.agents.find((item) => item.id === request.agentId);
		if (!agent?.editable) {
			throw new Error("この Agent は編集できません。");
		}
		const edit = agentEditSchema.parse(request.edit);
		if (edit.definition) {
			this.assertUniqueName(
				state.agents,
				agent.backend,
				edit.definition.name,
				agent.id,
			);
		}
		this.validateEffort(
			agent.backend,
			edit.model,
			agent.backend === "pi" ? edit.thinking : edit.reasoningEffort,
			agent.edit.model,
			agent.backend === "pi"
				? agent.edit.thinking
				: agent.edit.reasoningEffort,
		);
		this.validateModel(agent.backend, edit.model, agent.edit.model);
		if (agent.backend === "codex") {
			const old = state.files.codex[agent.id];
			if (old === undefined) {
				throw new Error("Agent 定義がありません。");
			}
			await writeWorkspaceFile(
				this.root,
				agent.id,
				old,
				editCodexAgent(old, edit),
			);
		} else {
			await this.savePiAgent(agent, edit, state);
		}
	}

	/** Pi の名前変更では上書き設定も移し、設定の保存失敗時は定義を戻す。 */
	private async savePiAgent(
		agent: ManagedAgent,
		edit: AgentEdit,
		state: Awaited<ReturnType<AgentManagerStore["read"]>>,
	) {
		assertPiEdit(edit);
		piSettings(state.files.piText);
		if (edit.definition && !agent.definitionPath) {
			throw new Error("プロジェクト定義だけを編集できます。");
		}
		const text = piOverrideText(state.files.piText, agent, edit);
		const rollback = await savePiDefinition(
			this.root,
			agent,
			edit,
			state.files.piAgents,
		);
		try {
			await writeWorkspaceFile(
				this.root,
				".pi/settings.json",
				state.files.piText,
				text,
			);
		} catch (error) {
			// 上書き設定が保存できなければ定義も戻す。外部編集との競合は上書きしない。
			await rollback();
			throw error;
		}
	}

	/** 新規作成や名前変更で、同じバックエンド内の名前が重複する場合は拒否する。 */
	private assertUniqueName(
		agents: ManagedAgent[],
		backend: "pi" | "codex",
		name: string,
		id?: string,
	) {
		if (
			agents.some(
				(agent) =>
					agent.backend === backend &&
					agent.name === name &&
					agent.id !== id,
			)
		) {
			throw new Error("同名の Agent が存在します。");
		}
	}

	/** 継承へ戻す操作と変更していない値は、未接続でも保持できる。 */
	private validateEffort(
		backend: "pi" | "codex",
		model: string | undefined,
		effort: string | undefined,
		previousModel?: string,
		previousEffort?: string,
	) {
		const error = effortError(
			this.models(backend),
			model,
			effort,
			previousModel,
			previousEffort,
		);
		if (error) {
			throw new Error(error);
		}
	}

	/** 継承へ戻す操作と変更していない値は、未接続でも保持できる。 */
	private validateModel(
		backend: "pi" | "codex",
		model: string | undefined,
		previous?: string,
	) {
		if (
			model &&
			model !== previous &&
			!this.models(backend).some((item) => item.value === model)
		) {
			throw new Error(
				"モデル一覧を再読み込みし、利用可能なモデルから選択してください。",
			);
		}
	}
}

/** JSON 全体を再生成せず、対象のプロパティだけを変更する。 */
function editJson(text: string, path: string[], value: unknown) {
	// 存在しない設定を削除する場合は、その設定を格納するオブジェクトも作らない。
	if (value === undefined && !findNodeAtLocation(parseTree(text)!, path)) {
		return text;
	}
	return applyEdits(
		text,
		modify(text, path, value, {
			formattingOptions: {
				insertSpaces: true,
				tabSize: 2,
				eol: text.includes("\r\n") ? "\r\n" : "\n",
			},
		}),
	);
}

/** 上書き設定の保存失敗時に、外部変更を検査して定義を元へ戻す。 */
async function savePiDefinition(
	root: string,
	agent: ManagedAgent,
	edit: AgentEdit,
	files: Record<string, string>,
) {
	const file = agent.definitionPath;
	if (!file || !edit.definition) {
		return () => Promise.resolve();
	}
	const old = files[file];
	if (old === undefined) {
		throw new Error("Agent 定義がありません。");
	}
	const next = editPiAgent(old, edit);
	await writeWorkspaceFile(root, file, old, next);
	return () => writeWorkspaceFile(root, file, next, old);
}

/** 名前変更では既存の上書き先との衝突を拒否し、設定を移す。 */
function piOverrideText(
	previous: string | undefined,
	agent: ManagedAgent,
	edit: AgentEdit,
) {
	let text = previous ?? "{}\n";
	const name = edit.definition?.name ?? agent.name;
	if (name !== agent.name) {
		const overrides = piSettings(previous).agentOverrides;
		if (overrides?.[name]) {
			throw new Error("変更先の名前には既存の上書き設定があります。");
		}
		const oldOverride = findNodeAtLocation(parseTree(text)!, [
			"subagents",
			"agentOverrides",
			agent.name,
		]);
		if (oldOverride) {
			text = editJson(
				text,
				["subagents", "agentOverrides", name],
				getNodeValue(oldOverride),
			);
		}
		text = editJson(
			text,
			["subagents", "agentOverrides", agent.name],
			undefined,
		);
	}
	for (const key of ["model", "thinking", "disabled"] as const) {
		text = editJson(
			text,
			["subagents", "agentOverrides", name, key],
			edit[key],
		);
	}
	return text;
}
