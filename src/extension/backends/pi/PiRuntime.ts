// ビルドが用意したESM入口を遅延読込し、Piの認証・設定で単一セッションを生成する。
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
	AgentSession,
	AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { type PiAuthorize } from "./PiApprovedTools";
import { createPiFileTools } from "./PiFileTools";
import { createPiSandboxPowerShellTool } from "./PiPowerShellTool";
import {
	createWorkspaceAccessPolicy,
	canonicalPath,
	WorkspacePathPolicy,
} from "../../security/WorkspacePathPolicy";
import type { SandboxCommandExecutor } from "../../runtime/SandboxCommandExecutor";
import {
	intersectAccessPolicies,
	type AgentAccessPolicy,
} from "../../security/AgentAccessPolicy";
import { freezeToolCall } from "../../security/ApprovedToolCall";
import { PiAccount, type PiAuthService } from "./PiAccount";
import { loadPiResources } from "./PiResources";
import { PiProviderControls } from "./PiProviderControls";
import { PiQuotaService } from "./PiQuotaService";
import { PiModelCatalogService } from "./PiModelCatalogService";
import type { SkillSummary } from "../../../shared/skills";
import {
	openPiSessionStore,
	type PiHistoryAccess,
	type PiResumeTarget,
	type PiSessionStorage,
} from "./PiSessionStore";

/** Controllerが必要とするSDKの操作だけを公開する。 */
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
	history?: PiHistoryAccess;
	account?: PiAccount;
	quota?: PiQuotaService;
	skills?: SkillSummary[];
	/** 未送信の新規会話だけ、送信前に保存先設定を読み直す。 */
	storageChanged?: () => boolean;
};
export type { AgentSessionEvent as PiEvent };

/** 実SDKとテスト接続を同じ寿命管理で扱う。 */
export type PiFactory = (
	signal: AbortSignal,
	authorize: PiAuthorize,
	resume?: PiResumeTarget,
) => Promise<{ session: PiSession; cwd: string }>;

/** 通常実行と隔離した疎通テストで使う起動条件。 */
export type PiRuntimeOptions = {
	extensionPath: string;
	cwd: string;
	workspaceRoots?: readonly string[];
	commandExecutor?: SandboxCommandExecutor;
	/** ユーザーがHostコードとして明示的に信頼した拡張ファイル。 */
	trustedExtensionPaths?: readonly string[];
	/** Hostが所有する親の上限。省略時にworkspace権限へ戻してはならない。 */
	parentPolicy: AgentAccessPolicy;
	/** subagentへ渡す親・roleの交差policy。workspace上限との交差だけを採用する。 */
	accessPolicy?: AgentAccessPolicy;
	agentDir?: string;
	/** 最後にUIで選択したモデルと推論レベル。 */
	preferredModel?: PiModelSelection;
	/** UIで確定したモデルを次回の新規セッション用に保存する。 */
	saveModel?: (selection: PiModelSelection) => Promise<void>;
	signal: AbortSignal;
	authorize?: PiAuthorize;
	storage?: PiSessionStorage;
	getStorage?: () => PiSessionStorage;
	resume?: PiResumeTarget;
	authService?: PiAuthService;
	/** 固定endpointへのHost通信だけを疎通テストで差し替える。 */
	request?: typeof fetch;
};

/** 秘密値を含まない、起動時モデルの保存形式。 */
export type PiModelSelection = {
	provider: string;
	model: string;
	reasoning?: string;
};

/** Pi標準形式で履歴を保存し、副作用ツールには必ずHostの承認を挟む。 */
export async function createPiRuntime(
	options: PiRuntimeOptions,
): Promise<PiSession> {
	options = snapshotPolicies(options);
	const sdkUrl = pathToFileURL(
		join(options.extensionPath, "dist/runtime/pi.mjs"),
	).href;
	const sdk = (await import(sdkUrl)) as typeof PiSdk;
	options.signal.throwIfAborted();
	const agentDir = options.agentDir || sdk.getAgentDir();
	const paths = await runtimePathPolicy(options, agentDir);
	const policy = paths.policy;
	const toolLifetime = new AbortController();
	await paths.resolve(options.cwd, "read");
	const settingsManager = sdk.SettingsManager.create(options.cwd, agentDir);
	// 会話の自動再実行はHost側の停止・承認の寿命と分離して無効化する。
	settingsManager.applyOverrides({
		compaction: { enabled: false },
		retry: { enabled: false, provider: { maxRetries: 0 } },
		cacheWarming: "off",
	});
	const authorize: PiAuthorize =
		options.authorize ??
		(() => Promise.reject(new Error("Piの実行承認が接続されていません。")));
	const controls = new PiProviderControls();
	const resourceLoader = await loadPiResources(
		sdk,
		options.cwd,
		agentDir,
		settingsManager,
		authorize,
		options.signal,
		policy,
		options.trustedExtensionPaths ?? [],
		controls,
	);
	options.signal.throwIfAborted();
	const modelRuntime = await sdk.ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: join(agentDir, "models.json"),
		modelsStorePath: join(agentDir, "models-store.json"),
		allowModelNetwork: true,
		modelRefreshTimeoutMs: 15_000,
		signal: options.signal,
	});
	// SDKが初期モデルを選ぶ前に、パッケージ由来providerも候補へ登録する。
	registerExtensionProviders(resourceLoader, modelRuntime);
	await modelRuntime.getAvailable(undefined, { signal: options.signal });
	const model = resolvePiInitialModel(options, modelRuntime);
	options.signal.throwIfAborted();
	const storage = sessionStorage(options);
	const { manager, history } = await openPiSessionStore(
		sdk,
		options.cwd,
		agentDir,
		storage,
		options.signal,
		options.resume,
	);
	const { session } = await sdk.createAgentSession({
		cwd: options.cwd,
		agentDir,
		settingsManager,
		resourceLoader,
		modelRuntime,
		...(model && !options.resume ? { model } : {}),
		sessionManager: manager,
		tools: [
			"read",
			"ls",
			"write",
			"edit",
			"powershell",
			...resourceLoader
				.getExtensions()
				.extensions.flatMap((extension) => [...extension.tools.keys()]),
		],
		customTools: [
			...createPiFileTools(sdk, paths, authorize, toolLifetime.signal),
			createPiSandboxPowerShellTool(
				sdk.createPowerShellToolDefinition(options.cwd),
				paths,
				authorize,
				commandExecutor(options),
				toolLifetime.signal,
			),
		],
	});
	controls.bind(session);
	const account = new PiAccount(
		modelRuntime,
		session,
		options.authService,
		controls,
		new PiModelCatalogService(modelRuntime, session, options.request),
		options.saveModel,
		options.resume ? undefined : options.preferredModel,
	);
	try {
		await session.bindExtensions({ mode: "print" });
		// 起動処理の完了前にlive候補と保存推論を適用し、SDK既定値を公開しない。
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
	const dispose = session.dispose.bind(session);
	return Object.assign(session, {
		dispose: () => {
			toolLifetime.abort();
			dispose();
		},
		history,
		storageChanged: () =>
			!options.resume &&
			session.messages.length === 0 &&
			!!options.getStorage &&
			options.getStorage() !== storage,
		account,
		quota: new PiQuotaService(modelRuntime, session, options.request),
		skills: resourceLoader.getSkills().skills.map((skill) => ({
			name: skill.name,
			description: skill.description,
			path: skill.filePath,
		})),
	});
}

/** 非同期起動前に親の上限を固定し、省略からの権限昇格を拒否する。 */
function snapshotPolicies(options: PiRuntimeOptions): PiRuntimeOptions {
	if (!options.parentPolicy) {
		throw new Error(
			"親のaccess policyが必要です。workspace権限への暗黙の昇格は許可されません。",
		);
	}
	return {
		...options,
		parentPolicy: freezeToolCall(options.parentPolicy),
		...(options.accessPolicy
			? { accessPolicy: freezeToolCall(options.accessPolicy) }
			: {}),
	};
}

/** 再開・subagentも保存済みpolicyを信用せず、現在のHost rootsで制限する。 */
async function runtimePathPolicy(options: PiRuntimeOptions, agentDir: string) {
	const workspace = await createWorkspaceAccessPolicy(
		options.workspaceRoots ?? [options.cwd],
	);
	const parent = intersectAccessPolicies(workspace, options.parentPolicy);
	const policy = options.accessPolicy
		? intersectAccessPolicies(parent, options.accessPolicy)
		: parent;
	// 次回のHostロードでagent生成物を実行・認証設定として扱わない。
	policy.filesystem.protectedPaths = [
		...policy.filesystem.protectedPaths,
		await canonicalPath(join(options.extensionPath, "dist"), options.cwd),
		await canonicalPath(agentDir, options.cwd),
	];
	return new WorkspacePathPolicy(freezeToolCall(policy), options.cwd);
}

/** テストや未接続の呼出元でもSDK direct executeへ戻さない。 */
function commandExecutor(options: PiRuntimeOptions): SandboxCommandExecutor {
	return (
		options.commandExecutor ?? {
			execute: () =>
				Promise.reject(
					new Error("Sandbox Executorが接続されていません。"),
				),
		}
	);
}

/** 最新の保存先設定を明示設定と既定値より優先する。 */
function sessionStorage(options: PiRuntimeOptions) {
	return options.getStorage?.() ?? options.storage ?? "global";
}

/** 拡張由来のproviderを初期モデル選択前に登録する。 */
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

/** providerとモデルの指定を検証してSDKの候補から解決する。 */
export function resolvePiInitialModel(
	options: PiRuntimeOptions,
	modelRuntime: PiSdk.ModelRuntime,
) {
	return (
		resolvePreferredModel(options.preferredModel, modelRuntime) ??
		(options.preferredModel
			? (modelRuntime
					.getAvailableSnapshot()
					.find(
						(model) =>
							model.provider === options.preferredModel?.provider,
					) ?? modelRuntime.getAvailableSnapshot()[0])
			: undefined)
	);
}

/** 保存モデルは現在の利用可能候補に残っている場合だけ復元する。 */
function resolvePreferredModel(
	selection: PiModelSelection | undefined,
	modelRuntime: PiSdk.ModelRuntime,
) {
	if (!selection?.provider.trim() || !selection.model.trim()) {
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
