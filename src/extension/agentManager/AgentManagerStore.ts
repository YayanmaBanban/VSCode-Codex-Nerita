// 読み取った世代を照合し、設定ごとの保存先へ必要なキーだけを書き込む。
import {
	applyEdits,
	modify,
	parseTree,
	findNodeAtLocation,
} from "jsonc-parser";
import {
	agentEditSchema,
	handoffSchema,
	defaultHandoff,
	piDefaultsSchema,
} from "../../shared/agentManager/config";
import type {
	ManagedAgent,
	ManagerModel,
	ManagerRequest,
} from "../../shared/agentManager/messages";
import { codexAgentFiles } from "./CodexAgentFiles";
import { editCodexAgent } from "./CodexAgentEdit";
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
} from "../../shared/agentManager/effort";

export type PiAgentReader = () => Promise<
	Awaited<ReturnType<typeof readPiAgents>>
>;
export type ManagerMutation = Extract<ManagerRequest, { generation: string }>;

/** Host のモデル候補は保存直前にも取得し、切断後の候補を使わない。 */
export class AgentManagerStore {
	constructor(
		readonly root: string,
		private pi: PiAgentReader,
		private models: (backend: "pi" | "codex") => ManagerModel[],
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
		const piText = await read(".pi/settings.json");
		const handoffText = await read(".nerita/handoff.json");
		const codex = await codexAgentFiles(this.root).catch(
			(error: unknown) => {
				errors.push(String(error));
				return { agents: [], files: {}, errors: [] };
			},
		);
		const pi = await this.pi().catch((error: unknown) => {
			errors.push(`Pi: ${String(error)}`);
			return {
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
				errors,
				codexErrors: codex.errors,
			}),
			files: {
				piText,
				handoffText,
				codex: codex.files as Record<string, string>,
			},
		};
	}

	/** 古い画面や外部編集との競合は、書き込む前にエラーとして返す。 */
	save(request: ManagerMutation, assertWritable: () => void = () => {}) {
		return serialized(this.root, async () => {
			assertWritable();
			const state = await this.read();
			if (request.generation !== state.generation) {
				throw new Error(
					"設定が変更されています。再読み込みしてから保存してください。",
				);
			}
			assertWritable();
			if (request.type === "handoff") {
				const config = handoffSchema.parse(request.config);
				const error = handoffEffortError(config, state.handoff, {
					pi: this.models("pi"),
					codex: this.models("codex"),
				});
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

	/** 保存するバックエンドに応じて、定義と override の書込み先を分ける。 */
	private async saveAgent(
		request: Extract<ManagerMutation, { type: "agent" }>,
		state: Awaited<ReturnType<AgentManagerStore["read"]>>,
	) {
		const agent = state.agents.find((item) => item.id === request.agentId);
		if (!agent?.editable) {
			throw new Error("この Agent は編集できません。");
		}
		const edit = agentEditSchema.parse(request.edit);
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
			if (edit.reasoningEffort !== undefined) {
				throw new Error(
					"Pi の設定に Codex の推論指定は保存できません。",
				);
			}
			piSettings(state.files.piText);
			let text = state.files.piText ?? "{}\n";
			for (const key of ["model", "thinking", "disabled"] as const) {
				text = editJson(
					text,
					["subagents", "agentOverrides", agent.name, key],
					edit[key],
				);
			}
			await writeWorkspaceFile(
				this.root,
				".pi/settings.json",
				state.files.piText,
				text,
			);
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
		previous: string | undefined,
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
	// 不在の設定を解除する操作では、中間のオブジェクトも作らない。
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
