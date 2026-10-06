// ビルドが用意した ESM 入口を遅延読込し、Pi の認証・設定で単一セッションを生成する。
import { loadPiSdk } from "./PiSdk";
import {
	isNonEmptyString,
	nonEmptyString,
} from "@nerita/shared/valuePredicates";
import { randomUUID } from "node:crypto";
import { bindPiOutputArchive } from "./results/PiOutputArchive";
import type { HandoffGenerator } from "../../session/HandoffContext";
import { generatePiHandoff } from "./PiHandoffGeneration";
import type { WorkspaceTrustStore } from "../../security/trust/WorkspaceTrustStore";
import {
	preparePiTrust,
	piWorkspaceTrusted,
	restrictPiStorage,
} from "./PiTrustAdapter";
import { preparePiWebTrust, type PiWebTrust } from "./PiWebTrust";
import type { WorkflowExecution } from "@nerita/shared/workflows/messages";
import { join } from "node:path";
import type {
	AgentSession,
	AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { type PiAuthorize } from "./PiApprovedTools";
import type {
	AgentAccessPolicy,
	AgentRole,
} from "../../security/AgentAccessPolicy";
import type { SandboxCommandExecutor } from "../../runtime/SandboxCommandExecutor";
import { preparePiRuntimeTools } from "./PiRuntimeTools";
import { resolveTrustedExtensions } from "./PiExtensionTrust";
import { PiAgentViews } from "./PiAgentViews";
import { PiAgentHistory, restorePiAgentRecords } from "./PiAgentHistory";
import { PiChildRuntimes } from "./PiChildRuntimes";
import { PiJobs } from "./PiJobs";
import type { PiForkMessage } from "./PiForkContext";
import { loadSubagentDefinitions } from "./PiSubagentDefinitions";
import { createPiSubagentTools } from "./PiSubagentTool";
import {
	createPiWorkflowTools,
	createPiWorkflowRunner,
} from "./workflows/PiWorkflowTool";
import { bindPiRuntimeLifetime } from "./PiRuntimeLifetime";
import { PiAccount, type PiAuthService } from "./PiAccount";
import { getPiDeviceId } from "./PiDeviceId";
import { loadPiResources } from "./PiResources";
import { PiProviderControls } from "./PiProviderControls";
import { PiQuotaService } from "./PiQuotaService";
import { openAICodexQuota } from "./openai/OpenAICodexQuota";
import { PiModelCatalogService } from "./PiModelCatalogService";
import { piFeatureSecrets } from "./PiFeatureSecrets";
import {
	PiCredentialStore,
	PiCredentialVault,
} from "../../credentials/PiCredentialStore";
import {
	CredentialStores,
	SessionMemoryCredentialStore,
} from "../../credentials/CredentialStore";
import { SecretAuthBackend } from "../../credentials/SecretAuthBackend";
import type { CredentialBroker } from "../../credentials/CredentialBroker";
import { piToolExposure } from "./PiToolFeatures";
import type { CommandPermissions } from "../../runtime/CommandPermissions";
import type { SandboxManagement } from "../../runtime/SandboxManagement";
import { abortableFeatureApproval } from "./PiFeatureSafety";
import { protectPiFeatureTool } from "./PiFeatureToolResults";
import type { SkillSummary } from "@nerita/shared/skills";
import {
	openPiSessionStore,
	type PiHistoryAccess,
	type PiResumeTarget,
	type PiSessionStorage,
} from "./PiSessionStore";

/** `Controller` が必要とする SDK の操作だけを公開する。 */
export type PiSession = Pick<
	AgentSession,
	| "sessionId"
	| "getContextUsage"
	| "model"
	| "subscribe"
	| "prompt"
	| "steer"
	| "isStreaming"
	| "clearQueue"
	| "abort"
	| "dispose"
> & {
	/** SDK 外から届く例外も、会話と同じ伏字辞書で公開前に保護する。 */
	protect?: <T>(value: T) => T;
	commandPermissions?: CommandPermissions;
	workflow?: (
		request: WorkflowExecution,
		signal: AbortSignal,
		authorize: PiAuthorize,
	) => Promise<string>;
	agentViews?: PiAgentViews;
	contextSource?: Pick<PiSdk.SessionManager, "buildSessionContext">;
	jobs?: PiJobs;
	history?: PiHistoryAccess;
	generateHandoff?: HandoffGenerator;
	account?: PiAccount;
	quota?: PiQuotaService;
	skills?: SkillSummary[];
	/** 未送信の新規会話だけ、送信前に保存先設定を読み直す。 */
	storageChanged?: () => boolean;
	close?: () => Promise<void>;
};
/** 共通 Host API の子だけを管理し、外部拡張の独自サブエージェントとは区別する。 */
export type PiRuntimeSession = PiSession & {
	accessPolicy: AgentAccessPolicy;
	children: PiChildRuntimes;
	close: () => Promise<void>;
};
export type { AgentSessionEvent as PiEvent };

/** SDK 本体とテスト用の接続に共通する、起動・中断のインターフェース。 */
export type PiFactory = (
	signal: AbortSignal,
	authorize: PiAuthorize,
	resume?: PiResumeTarget,
) => Promise<{ session: PiSession; cwd: string }>;

/** 通常実行と隔離した疎通テストで使う起動条件。 */
export type PiRuntimeOptions = {
	credentials?: PiCredentialStore;
	credentialBroker?: CredentialBroker;
	mcpBackend?: () => Promise<SecretAuthBackend>;
	sandboxManagement?: SandboxManagement;
	commandPermissions?: CommandPermissions;
	extensionPath: string;
	cwd: string;
	agentDir?: string;
	/** 最後に UI で選択したモデルと推論レベル。 */
	preferredModel?: PiModelSelection;
	/** UI で確定したモデルを次回の新規セッション用に保存する。 */
	saveModel?: (selection: PiModelSelection) => Promise<void>;
	signal: AbortSignal;
	authorize?: PiAuthorize;
	storage?: PiSessionStorage;
	getStorage?: () => PiSessionStorage;
	resume?: PiResumeTarget;
	authService?: PiAuthService;
	/** 固定エンドポイントへの Host 通信だけを疎通テストで差し替える。 */
	request?: typeof fetch;
	workspaceRoots?: string[];
	workspaceTrusted?: boolean;
	trustStore?: WorkspaceTrustStore;
	trustEnabled?: () => boolean;
	trustContextId?: string;
	webTrust?: PiWebTrust[];
	trustedExtensionPaths?: string[];
	executor?: SandboxCommandExecutor | null;
	parentPolicy?: AgentAccessPolicy;
	role?: AgentRole;
	/** 子の実行環境で使う内部履歴を、親の履歴一覧へ保存しない。 */
	ephemeral?: boolean;
	/** 実行基盤の利用不能も子へ継承し、フォールバックによる有効化を防ぐ。 */
	sandboxUnavailable?: string;
	allowedTools?: string[];
	codemode?: boolean;
	toolSearch?: boolean;
	subagentPrompt?: string;
	subagentPromptMode?: "append" | "replace";
	strictModel?: boolean;
	initialMessages?: PiForkMessage[];
};

/** 子のメモリー内セッションだけに、固定した親会話を追加する。 */
function seedChildContext(
	manager: PiSdk.SessionManager,
	messages: PiForkMessage[] = [],
) {
	for (const message of messages) {
		manager.appendMessage(message);
	}
}

/** 秘密値を含まない、起動時モデルの保存形式。 */
export type PiModelSelection = {
	provider: string;
	model: string;
	reasoning?: string;
};

/** Pi 標準形式で履歴を保存し、副作用ツールには必ず Host の承認を挟む。 */
export async function createPiRuntime(
	options: PiRuntimeOptions,
): Promise<PiRuntimeSession> {
	options = credentialRuntimeOptions(options);
	if (options.trustStore) {
		options = {
			...options,
			webTrust: await preparePiWebTrust(
				options.trustedExtensionPaths ?? [],
				options.trustStore,
			),
		};
	}
	const trust = preparePiTrust(options);
	try {
		const session = await openPiRuntime(
			await restrictPiStorage(trust.options),
		);
		const dispose = session.dispose.bind(session);
		session.dispose = () => {
			trust.dispose();
			dispose();
		};
		const close = session.close;
		session.close = async () => {
			try {
				await close();
			} finally {
				trust.dispose();
			}
		};
		trust.options.signal.addEventListener("abort", trust.dispose, {
			once: true,
		});
		return session;
	} catch (error) {
		trust.dispose();
		throw error;
	}
}

/** 信頼コンテキストの準備が終わった起動条件だけで SDK を組み立てる。 */
async function openPiRuntime(
	options: PiRuntimeOptions,
): Promise<PiRuntimeSession> {
	const parentSignal = options.signal;
	const lifetime = new AbortController();
	options = {
		...options,
		signal: AbortSignal.any([parentSignal, lifetime.signal]),
	};
	const sdk = await loadPiSdk(options.extensionPath);
	options.signal.throwIfAborted();
	const resources = await prepareRuntimeResources(options, sdk);
	options = resources.options;
	const { agentDir, resourceLoader, runtimeTools } = resources;
	options.signal.throwIfAborted();
	const { storage, modelRuntime, model } = await prepareRuntimeModel(
		sdk,
		resources,
	);
	const { manager, history } = await openRuntimeSessionStore(
		options,
		sdk,
		agentDir,
		storage,
	);
	const { customTools, extensionTools } = runtimeCustomTools(
		resourceLoader,
		runtimeTools,
		options,
	);
	seedChildContext(manager, options.initialMessages);
	const { agentViews, jobs, children } = prepareRuntimeDelegation(
		manager,
		resources,
		customTools,
	);
	const { session } = await createConfiguredPiSession(
		resources,
		customTools,
		modelRuntime,
		model,
		manager,
		extensionTools,
		sdk,
	);
	agentViews.parentId = session.sessionId;
	const account = await bindRuntimeAccount(
		resources,
		session,
		modelRuntime,
		sdk,
	);
	const stopJobs = session.abort.bind(session);
	session.abort = async () => {
		await Promise.all([jobs.stop(), stopJobs()]);
	};
	bindPiOutputArchive(session, history?.outputs);
	const close = bindPiRuntimeLifetime(
		session,
		children,
		lifetime,
		parentSignal,
	);
	return runtimeSessionFacade(
		session,
		modelRuntime,
		account,
		resources,
		children,
		agentViews,
		jobs,
		manager,
		close,
		history,
		storage,
	);
}

/** 一時セッションと永続履歴の保存先を選ぶ。 */
async function openRuntimeSessionStore(
	options: PiRuntimeOptions,
	sdk: Awaited<ReturnType<typeof loadPiSdk>>,
	agentDir: string,
	storage: PiSessionStorage,
) {
	return options.ephemeral === true
		? {
				manager: sdk.SessionManager.inMemory(options.cwd),
				history: undefined,
			}
		: await openPiSessionStore(
				sdk,
				options.cwd,
				agentDir,
				storage,
				options.signal,
				options.resume,
			);
}

/** Host が利用する履歴・ワークフロー・利用量の入口をセッションへ接続する。 */
function runtimeSessionFacade(
	session: AgentSession,
	modelRuntime: PiSdk.ModelRuntime,
	account: PiAccount,
	resources: Awaited<ReturnType<typeof prepareRuntimeResources>>,
	children: PiChildRuntimes,
	agentViews: PiAgentViews,
	jobs: PiJobs,
	manager: PiSdk.SessionManager,
	close: () => Promise<void>,
	history: PiHistoryAccess | undefined,
	storage: PiSessionStorage,
): PiRuntimeSession | PromiseLike<PiRuntimeSession> {
	const { subagents, runtimeTools, options, resourceLoader } = resources;

	return Object.assign(session, {
		protect: <T>(value: T) =>
			options.credentials!.vault.stores.redactor.value(value),
		generateHandoff: (request: Parameters<HandoffGenerator>[0]) =>
			generatePiHandoff(
				modelRuntime,
				request,
				account
					.agentModels()
					.find((item) => item.value === request.model)?.efforts,
			),
		workflow: createRuntimeWorkflow(
			subagents,
			children,
			runtimeTools,
			options,
			agentViews,
			jobs,
			manager,
			session,
		),
		accessPolicy: runtimeTools.paths.policy,
		...(options.commandPermissions
			? { commandPermissions: options.commandPermissions }
			: {}),
		contextSource: manager,
		agentViews,
		jobs,
		children,
		close,
		...(history ? { history } : {}),
		storageChanged: () =>
			!options.resume &&
			session.messages.length === 0 &&
			jobs.list().length === 0 &&
			!!options.getStorage &&
			options.getStorage() !== storage,
		account,
		quota: new PiQuotaService(
			modelRuntime,
			session,
			options.request,
			undefined,
			openAICodexQuota(
				options.extensionPath,
				options.cwd,
				options.signal,
			),
		),
		skills: resourceLoader.getSkills().skills.map((skill) => ({
			name: skill.name,
			description: skill.description,
			path: skill.filePath,
		})),
	});
}

/** 親の許可と履歴を接続してワークフローを実行する。 */
function createRuntimeWorkflow(
	subagents: Awaited<ReturnType<typeof runtimeSubagents>>,
	children: PiChildRuntimes,
	runtimeTools: Awaited<ReturnType<typeof preparePiRuntimeTools>>,
	options: PiRuntimeOptions,
	agentViews: PiAgentViews,
	jobs: PiJobs,
	manager: PiSdk.SessionManager,
	session: AgentSession,
): (
	request: WorkflowExecution,
	signal: AbortSignal,
	directAuthorize: PiAuthorize,
) => Promise<string> {
	return async (
		request: WorkflowExecution,
		signal: AbortSignal,
		directAuthorize: PiAuthorize,
	) => {
		const run = createPiWorkflowRunner(
			subagents.workflowPackage,
			subagents.definitions,
			children,
			runtimeTools.paths.policy,
			options.cwd,
			directAuthorize,
			options.signal,
			agentViews,
			jobs,
			manager,
		);
		if (!run) {
			throw new Error(
				"pi-subagents が未導入です。ユーザー設定へ登録して再接続してください。",
			);
		}
		const result = await run(
			randomUUID(),
			{ action: "run", file: request.file, async: false },
			signal,
			session.model,
			request.text,
		);
		return result.content.map((item) => item.text).join("\n");
	};
}

/** 拡張接続とカタログ更新に失敗した場合はセッションを破棄する。 */
async function bindRuntimeAccount(
	resources: Awaited<ReturnType<typeof prepareRuntimeResources>>,
	session: AgentSession,
	modelRuntime: PiSdk.ModelRuntime,
	sdk: Awaited<ReturnType<typeof loadPiSdk>>,
) {
	const { controls, options, subagents, agentDir } = resources;

	controls.bind(session);
	controls.bindDelegation(
		() =>
			!options.signal.aborted &&
			modelRuntime.hasConfiguredAuth("openai") &&
			subagents.definitions.length > 0 &&
			session.getActiveToolNames().includes("subagent"),
	);
	const account = new PiAccount(
		modelRuntime,
		session,
		options.authService,
		controls,
		new PiModelCatalogService(modelRuntime, session, options.request),
		options.saveModel,
		options.resume ? undefined : options.preferredModel,
		(model) => sdk.getSupportedThinkingLevels(model),
		() => getPiDeviceId(agentDir),
		options.credentials,
	);
	try {
		await session.bindExtensions({ mode: "print" });
		// 起動処理の完了前に取得したカタログの候補と保存推論を適用し、SDK 既定値を公開しない。
		await account.refreshCatalog(options.signal);
		options.signal.throwIfAborted();
	} catch (error) {
		session.dispose();
		throw error;
	}
	if (options.signal.aborted) {
		session.dispose();
		options.signal.throwIfAborted();
		throw new Error(
			"Piの認証・モデルを設定してください。Pi CLIのログイン、またはproviderのAPIキーを設定後に再接続してください。",
		);
	}
	return account;
}

/** 子とジョブの履歴を復元し、許可した委譲ツールだけを追加する。 */
function prepareRuntimeDelegation(
	manager: PiSdk.SessionManager,
	resources: Awaited<ReturnType<typeof prepareRuntimeResources>>,
	customTools: PiSdk.ToolDefinition[],
) {
	const { options, runtimeTools, subagents, authorize } = resources;

	const agentHistory = new PiAgentHistory(manager);
	const agentViews = new PiAgentViews((record) => agentHistory.write(record));
	agentViews.restore(
		restorePiAgentRecords(manager.getBranch()),
		manager.getSessionId(),
		options.cwd,
	);
	const jobs = new PiJobs(agentViews, manager);
	jobs.restore(manager.getBranch(), manager.getSessionId());
	const children = createChildren(options, runtimeTools, jobs);
	customTools.push(
		...permittedTools(
			createPiSubagentTools(
				subagents.definitions,
				children,
				runtimeTools.paths.policy,
				options.cwd,
				authorize,
				options.signal,
				agentViews,
				jobs,
				manager,
			),
			options.allowedTools,
		),
	);
	customTools.push(
		...permittedTools(
			createPiWorkflowTools(
				subagents.workflowPackage,
				subagents.definitions,
				children,
				runtimeTools.paths.policy,
				options.cwd,
				authorize,
				options.signal,
				agentViews,
				jobs,
				manager,
			),
			options.allowedTools,
		),
	);
	return { agentViews, jobs, children };
}

/** 信頼した拡張による `bash` の置き換えと、子のツール許可リストを反映する。 */
function runtimeCustomTools(
	resourceLoader: PiSdk.DefaultResourceLoader,
	runtimeTools: Awaited<ReturnType<typeof preparePiRuntimeTools>>,
	options: PiRuntimeOptions,
) {
	const extensionTools = resourceLoader
		.getExtensions()
		.extensions.flatMap((extension) => [...extension.tools.keys()]);
	// 非 Windows では、明示的に信頼した `bash` 拡張が SDK 標準ツールを置き換えられる。
	const customTools = permittedTools(
		runtimeTools.tools,
		options.allowedTools,
	).filter(
		(tool) =>
			!(
				process.platform !== "win32" &&
				tool.name === "bash" &&
				extensionTools.includes("bash")
			),
	);
	return { customTools, extensionTools };
}

/** 拡張由来のプロバイダーを登録してから初期モデルを検証する。 */
async function prepareRuntimeModel(
	sdk: Awaited<ReturnType<typeof loadPiSdk>>,
	resources: Awaited<ReturnType<typeof prepareRuntimeResources>>,
) {
	const { agentDir, options, resourceLoader } = resources;
	const modelRuntime = await sdk.ModelRuntime.create({
		credentials: options.credentials!,
		modelsPath: join(agentDir, "models.json"),
		modelsStorePath: join(agentDir, "models-store.json"),
		allowModelNetwork: true,
		modelRefreshTimeoutMs: 15000,
		signal: options.signal,
	});
	// SDK が初期モデルを選ぶ前に、パッケージ由来プロバイダーも候補へ登録する。
	registerExtensionProviders(resourceLoader, modelRuntime);
	await modelRuntime.getAvailable(undefined, { signal: options.signal });
	const model = resolvePiInitialModel(options, modelRuntime);
	validateChildModel(options, model);
	options.signal.throwIfAborted();
	const storage = await trustedSessionStorage(options);
	return { storage, modelRuntime, model };
}

/** 信頼・承認・ツールの準備を終えてから拡張資源を読み込む。 */
async function prepareRuntimeResources(
	options: PiRuntimeOptions,
	sdk: Awaited<ReturnType<typeof loadPiSdk>>,
) {
	const agentDir = nonEmptyString(options.agentDir) ?? sdk.getAgentDir();
	const settingsManager = sdk.SettingsManager.create(options.cwd, agentDir);
	settingsManager.setProjectTrusted(await piWorkspaceTrusted(options));
	// Host 側の停止・承認管理を経ずに会話を再実行しないよう、SDK の自動再試行などを無効化する。
	settingsManager.applyOverrides({
		compaction: { enabled: false },
		retry: { enabled: false, provider: { maxRetries: 0 } },
		cacheWarming: "off",
	});
	const originalAuthorize: PiAuthorize =
		options.authorize ??
		(() => Promise.reject(new Error("Piの実行承認が接続されていません。")));
	const authorize = runtimeAuthorizer(originalAuthorize, options.codemode);
	const runtimeTools = await preparePiRuntimeTools(
		sdk,
		options,
		authorize,
		settingsManager,
	);
	options = { ...options, cwd: runtimeTools.paths.cwd };
	const trustedExtensions = await runtimeExtensions(
		options,
		settingsManager,
		runtimeTools.paths.policy,
	);
	const subagents = await runtimeSubagents(
		sdk,
		options,
		agentDir,
		settingsManager,
		trustedExtensions,
	);
	const controls = new PiProviderControls();
	const toolRegistry = new Set<string>();
	const resourceLoader = await loadPiResources(
		sdk,
		options.cwd,
		agentDir,
		settingsManager,
		authorize,
		options.signal,
		controls,
		subagents.trusted,
		runtimeTools.paths.policy,
		options.subagentPrompt,
		options.subagentPromptMode,
		options.webTrust,
		{
			registry: toolRegistry,
			...(options.mcpBackend ? { mcpBackend: options.mcpBackend } : {}),
			codemode: options.codemode,
			toolSearch: options.toolSearch,
			allowedTools: options.allowedTools,
			secrets: () => piFeatureSecrets(),
			protect: <T>(value: T) =>
				options.credentials!.vault.stores.redactor.value(value),
		},
	);
	return {
		agentDir,
		resourceLoader,
		runtimeTools,
		subagents,
		authorize,
		toolRegistry,
		settingsManager,
		controls,
		options,
	};
}

/** コード経由のツール実行でも、UI の承認応答を待つ間は中断を受け付ける。 */
function runtimeAuthorizer(
	authorize: PiAuthorize,
	codemode?: boolean,
): PiAuthorize {
	return codemode === true
		? (request, signal) =>
				abortableFeatureApproval(authorize(request, signal), signal)
		: authorize;
}

/** 親の実行基盤と利用不能理由も子の起動条件へ固定する。 */
function createChildren(
	options: PiRuntimeOptions,
	tools: Awaited<ReturnType<typeof preparePiRuntimeTools>>,
	jobs: PiJobs,
) {
	return new PiChildRuntimes(
		{
			...options,
			executor: tools.executor,
			...(isNonEmptyString(tools.unavailable)
				? { sandboxUnavailable: tools.unavailable }
				: {}),
		},
		tools.paths.policy,
		options.signal,
		createPiRuntime,
		jobs,
	);
}

/** `Workspace Trust` とユーザー許可を、コードをロードする前に照合する。 */
async function runtimeExtensions(
	options: PiRuntimeOptions,
	settings: PiSdk.SettingsManager,
	policy: AgentAccessPolicy,
) {
	const trusted = await piWorkspaceTrusted(options);
	settings.setProjectTrusted(trusted);
	return resolveTrustedExtensions(
		options.trustedExtensionPaths ?? [],
		policy.workspaceRoots,
		trusted,
		async (path) => {
			const allowed =
				options.workspaceTrusted === true &&
				(await options.trustStore!.trusted(path));
			if (!allowed) {
				options.trustStore!.audit("extension-load-denied", path);
			}
			return allowed;
		},
	);
}

/** 最新の保存先設定を明示設定と既定値より優先する。 */
function sessionStorage(options: PiRuntimeOptions) {
	return options.getStorage?.() ?? options.storage ?? "global";
}

/** 未信頼の会話履歴はワークスペース内へ書き込まない。 */
async function trustedSessionStorage(options: PiRuntimeOptions) {
	return (await piWorkspaceTrusted(options))
		? sessionStorage(options)
		: "global";
}

/** 拡張由来のプロバイダーを初期モデル選択前に登録する。 */
function registerExtensionProviders(
	resourceLoader: PiSdk.DefaultResourceLoader,
	modelRuntime: PiSdk.ModelRuntime,
) {
	const registrations = resourceLoader.getExtensions().runtime;
	for (const registration of registrations.pendingProviderRegistrations) {
		modelRuntime.registerProvider(registration.name, registration.config);
	}
	for (const registration of registrations.pendingNativeProviderRegistrations) {
		modelRuntime.registerNativeProvider(registration.provider);
	}
}

/** プロバイダーとモデルの指定を検証して SDK の候補から解決する。 */
export function resolvePiInitialModel(
	options: PiRuntimeOptions,
	modelRuntime: PiSdk.ModelRuntime,
) {
	return (
		resolvePreferredModel(options.preferredModel, modelRuntime) ??
		(options.preferredModel
			? ((options.preferredModel.provider === "openai-codex"
					? modelRuntime
							.getAvailableSnapshot()
							.find((model) => model.provider === "openai")
					: undefined) ??
				modelRuntime
					.getAvailableSnapshot()
					.find(
						(model) =>
							model.provider === options.preferredModel?.provider,
					) ??
				modelRuntime.getAvailableSnapshot()[0])
			: undefined)
	);
}

/** 保存モデルは現在の利用可能候補に残っている場合だけ復元する。 */
function resolvePreferredModel(
	selection: PiModelSelection | undefined,
	modelRuntime: PiSdk.ModelRuntime,
) {
	if (
		!isNonEmptyString(selection?.provider.trim()) ||
		selection.model.trim() === ""
	) {
		return undefined;
	}
	return modelRuntime
		.getAvailableSnapshot()
		.find(
			(model) =>
				model.provider === selection.provider.trim() &&
				model.id === selection.model.trim(),
		);
}
/** 子には定義探索と再委譲用ツールを公開しない。 */
async function runtimeSubagents(
	sdk: Awaited<ReturnType<typeof loadPiSdk>>,
	options: PiRuntimeOptions,
	agentDir: string,
	settings: PiSdk.SettingsManager,
	trusted: string[],
) {
	return options.parentPolicy
		? { definitions: [], trusted, workflowPackage: undefined }
		: loadSubagentDefinitions(
				sdk,
				options.cwd,
				agentDir,
				settings,
				trusted,
			);
}
/** 指定モデルの不在を別モデルへの自動切替で隠さない。 */
function validateChildModel(
	options: PiRuntimeOptions,
	model: ReturnType<typeof resolvePiInitialModel>,
) {
	if (
		options.strictModel === true &&
		(!model ||
			model.id !== options.preferredModel?.model ||
			model.provider !== options.preferredModel.provider)
	) {
		throw new Error("子に指定されたモデルを利用できません。");
	}
}
/** 子の許可リストにないツールは定義自体を登録しない。 */
function permittedTools(
	tools: PiSdk.ToolDefinition[],
	allowed: string[] | undefined,
) {
	return tools.filter((tool) => !allowed || allowed.includes(tool.name));
}

/** 公開できるツールの設定を確定してから SDK のセッションへ渡す。 */
async function createConfiguredPiSession(
	resources: Awaited<ReturnType<typeof prepareRuntimeResources>>,
	customTools: PiSdk.ToolDefinition[],
	modelRuntime: PiSdk.ModelRuntime,
	model: ReturnType<typeof resolvePiInitialModel>,
	manager: PiSdk.SessionManager,
	extensionTools: string[],
	sdk: Awaited<ReturnType<typeof loadPiSdk>>,
) {
	const { options, agentDir, resourceLoader, toolRegistry, settingsManager } =
		resources;

	const features = {
		codemode: options.codemode,
		toolSearch: options.toolSearch,
		secrets: () => piFeatureSecrets(),
		protect: <T>(value: T) =>
			options.credentials!.vault.stores.redactor.value(value),
	};
	const exposedTools = customTools.map((tool) =>
		protectPiFeatureTool(piToolExposure(tool, features), features),
	);
	const activeExtensions = resourceLoader
		.getExtensions()
		.extensions.flatMap((extension) =>
			[...extension.tools.values()]
				.filter(
					(tool) =>
						tool.definition.exposure !== "deferred" &&
						tool.definition.exposure !== "codemode",
				)
				.map((tool) => tool.definition.name),
		);
	exposedTools.forEach((tool) => toolRegistry.add(tool.name));
	const sessionOptions = {
		cwd: options.cwd,
		agentDir,
		settingsManager,
		resourceLoader,
		modelRuntime,
		...(model && !options.resume ? { model } : {}),
		sessionManager: manager,
		tools: [...exposedTools.map((tool) => tool.name), ...extensionTools],
		neritaAllowedToolNames: toolRegistry,
		neritaActiveToolNames: [
			...exposedTools
				.filter(
					(tool) =>
						tool.exposure !== "deferred" &&
						tool.exposure !== "codemode",
				)
				.map((tool) => tool.name),
			...activeExtensions,
		],
		customTools: exposedTools,
	};
	const { session } = await sdk.createAgentSession(sessionOptions);
	return { session };
}
/** 認証と MCP 保存の境界を子 Runtime と共有し、SDK の既定ファイルへ戻さない。 */
function credentialRuntimeOptions(options: PiRuntimeOptions): PiRuntimeOptions {
	options = {
		...options,
		credentials:
			options.credentials ??
			new PiCredentialStore(
				new PiCredentialVault(
					new CredentialStores(new SessionMemoryCredentialStore()),
					{ read: () => undefined, write: async () => {} },
				),
			),
	};
	const stores = options.credentials!.vault.stores;
	let backend: Promise<SecretAuthBackend> | undefined;
	return {
		...options,
		mcpBackend:
			options.mcpBackend ??
			(() =>
				(backend ??= SecretAuthBackend.create(
					stores.memory,
					stores.redactor,
				))),
	};
}
