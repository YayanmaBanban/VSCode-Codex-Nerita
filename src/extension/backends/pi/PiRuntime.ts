// ビルドが用意したESM入口を遅延読込し、Piの認証・設定で単一セッションを生成する。
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
	AgentSession,
	AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { approvePiTool, type PiAuthorize } from "./PiApprovedTools";
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
	agentDir?: string;
	provider?: string;
	model?: string;
	signal: AbortSignal;
	authorize?: PiAuthorize;
	storage?: PiSessionStorage;
	getStorage?: () => PiSessionStorage;
	resume?: PiResumeTarget;
	authService?: PiAuthService;
	/** 固定endpointへのHost通信だけを疎通テストで差し替える。 */
	request?: typeof fetch;
};

/** Pi標準形式で履歴を保存し、副作用ツールには必ずHostの承認を挟む。 */
export async function createPiRuntime(
	options: PiRuntimeOptions,
): Promise<PiSession> {
	const sdkUrl = pathToFileURL(
		join(options.extensionPath, "dist/runtime/pi.mjs"),
	).href;
	const sdk = (await import(sdkUrl)) as typeof PiSdk;
	options.signal.throwIfAborted();
	const agentDir = options.agentDir || sdk.getAgentDir();
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
		controls,
	);
	options.signal.throwIfAborted();
	const modelRuntime = await sdk.ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: join(agentDir, "models.json"),
		modelsStorePath: join(agentDir, "models-cache.json"),
		signal: options.signal,
	});
	const provider = options.provider?.trim();
	// SDKが初期モデルを選ぶ前に、パッケージ由来providerも候補へ登録する。
	const registrations = resourceLoader.getExtensions().runtime;
	for (const registration of registrations.pendingProviderRegistrations) {
		modelRuntime.registerProvider(registration.name, registration.config);
	}
	for (const registration of registrations.pendingNativeProviderRegistrations) {
		modelRuntime.registerNativeProvider(registration.provider);
	}
	await modelRuntime.getAvailable(undefined, { signal: options.signal });
	const modelId = options.model?.trim();
	if (!!provider !== !!modelId) {
		throw new Error(
			"nerita.pi.provider と nerita.pi.model は両方指定してください。",
		);
	}
	const model =
		provider && modelId
			? modelRuntime.getModel(provider, modelId)
			: undefined;
	if (provider && !model) {
		throw new Error(`Piのモデルが見つかりません: ${provider}/${modelId}`);
	}
	options.signal.throwIfAborted();
	const storage = options.getStorage?.() ?? options.storage ?? "global";
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
			sdk.createWriteToolDefinition(options.cwd),
			sdk.createEditToolDefinition(options.cwd),
			sdk.createPowerShellToolDefinition(options.cwd),
		].map((tool) => approvePiTool(tool, options.cwd, authorize)),
	});
	controls.bind(session);
	try {
		await session.bindExtensions({ mode: "print" });
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
	return Object.assign(session, {
		history,
		storageChanged: () =>
			!options.resume &&
			session.messages.length === 0 &&
			!!options.getStorage &&
			options.getStorage() !== storage,
		account: new PiAccount(
			modelRuntime,
			session,
			options.authService,
			controls,
			new PiModelCatalogService(modelRuntime, session, options.request),
		),
		quota: new PiQuotaService(modelRuntime, session, options.request),
		skills: resourceLoader.getSkills().skills.map((skill) => ({
			name: skill.name,
			description: skill.description,
			path: skill.filePath,
		})),
	});
}
