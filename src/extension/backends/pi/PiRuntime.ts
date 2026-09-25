// ビルドが用意した ESM 入口を遅延読込し、Pi の認証・設定で単一セッションを生成する。
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
	AgentSession,
	AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { type PiAuthorize } from "./PiApprovedTools";
import type {
	AgentAccessPolicy,
	AgentRole,
	WindowsSandboxImplementation,
} from "../../security/AgentAccessPolicy";
import type { SandboxCommandExecutor } from "../../runtime/SandboxCommandExecutor";
import { preparePiRuntimeTools } from "./PiRuntimeTools";
import { resolveTrustedExtensions } from "./PiExtensionTrust";
import { PiChildRuntimes } from "./PiChildRuntimes";
import { bindPiRuntimeLifetime } from "./PiRuntimeLifetime";
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
	history?: PiHistoryAccess;
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

/** 実 SDK とテスト接続を同じ寿命管理で扱う。 */
export type PiFactory = (
	signal: AbortSignal,
	authorize: PiAuthorize,
	resume?: PiResumeTarget,
) => Promise<{ session: PiSession; cwd: string }>;

/** 通常実行と隔離した疎通テストで使う起動条件。 */
export type PiRuntimeOptions = {
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
	trustedExtensionPaths?: string[];
	windowsSandbox?: WindowsSandboxImplementation;
	executor?: SandboxCommandExecutor | null;
	parentPolicy?: AgentAccessPolicy;
	role?: AgentRole;
	/** 共通子 Runtime の内部履歴を親の履歴一覧へ保存しない。 */
	ephemeral?: boolean;
	/** 実行基盤の利用不能も子へ継承し、フォールバックによる有効化を防ぐ。 */
	sandboxUnavailable?: string;
};

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
	const parentSignal = options.signal;
	const lifetime = new AbortController();
	options = {
		...options,
		signal: AbortSignal.any([parentSignal, lifetime.signal]),
	};
	const sdkUrl = pathToFileURL(
		join(options.extensionPath, "dist/runtime/pi.mjs"),
	).href;
	const sdk = (await import(sdkUrl)) as typeof PiSdk;
	options.signal.throwIfAborted();
	const agentDir = options.agentDir || sdk.getAgentDir();
	const settingsManager = sdk.SettingsManager.create(options.cwd, agentDir);
	// 会話の自動再実行は Host 側の停止・承認の寿命と分離して無効化する。
	settingsManager.applyOverrides({
		compaction: { enabled: false },
		retry: { enabled: false, provider: { maxRetries: 0 } },
		cacheWarming: "off",
	});
	const authorize: PiAuthorize =
		options.authorize ??
		(() => Promise.reject(new Error("Piの実行承認が接続されていません。")));
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
	const controls = new PiProviderControls();
	const resourceLoader = await loadPiResources(
		sdk,
		options.cwd,
		agentDir,
		settingsManager,
		authorize,
		options.signal,
		controls,
		trustedExtensions,
		runtimeTools.paths.policy,
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
	// SDK が初期モデルを選ぶ前に、パッケージ由来プロバイダーも候補へ登録する。
	registerExtensionProviders(resourceLoader, modelRuntime);
	await modelRuntime.getAvailable(undefined, { signal: options.signal });
	const model = resolvePiInitialModel(options, modelRuntime);
	options.signal.throwIfAborted();
	const storage = sessionStorage(options);
	const { manager, history } = options.ephemeral
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
	const extensionTools = resourceLoader
		.getExtensions()
		.extensions.flatMap((extension) => [...extension.tools.keys()]);
	// 非 Windows では、明示的に信頼した `bash` 拡張が SDK 標準ツールを置き換えられる。
	const customTools = runtimeTools.tools.filter(
		(tool) =>
			!(
				process.platform !== "win32" &&
				tool.name === "bash" &&
				extensionTools.includes("bash")
			),
	);
	const { session } = await sdk.createAgentSession({
		cwd: options.cwd,
		agentDir,
		settingsManager,
		resourceLoader,
		modelRuntime,
		...(model && !options.resume ? { model } : {}),
		sessionManager: manager,
		tools: [...customTools.map((tool) => tool.name), ...extensionTools],
		customTools,
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
	const children = createChildren(options, runtimeTools);
	const close = bindPiRuntimeLifetime(
		session,
		children,
		lifetime,
		parentSignal,
	);
	return Object.assign(session, {
		accessPolicy: runtimeTools.paths.policy,
		children,
		close,
		...(history ? { history } : {}),
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

/** 親の実行基盤と利用不能理由も子の起動条件へ固定する。 */
function createChildren(
	options: PiRuntimeOptions,
	tools: Awaited<ReturnType<typeof preparePiRuntimeTools>>,
) {
	return new PiChildRuntimes(
		{
			...options,
			executor: tools.executor,
			...(tools.unavailable
				? { sandboxUnavailable: tools.unavailable }
				: {}),
		},
		tools.paths.policy,
		options.signal,
		createPiRuntime,
	);
}

/** Workspace Trust とユーザー許可を、コードをロードする前に照合する。 */
async function runtimeExtensions(
	options: PiRuntimeOptions,
	settings: PiSdk.SettingsManager,
	policy: AgentAccessPolicy,
) {
	const trusted = options.workspaceTrusted ?? true;
	settings.setProjectTrusted(trusted);
	return resolveTrustedExtensions(
		options.trustedExtensionPaths ?? [],
		policy.workspaceRoots,
		trusted,
	);
}

/** 最新の保存先設定を明示設定と既定値より優先する。 */
function sessionStorage(options: PiRuntimeOptions) {
	return options.getStorage?.() ?? options.storage ?? "global";
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
