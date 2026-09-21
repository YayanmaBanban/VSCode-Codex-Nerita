// 配布済みESM SDKを遅延読込し、Piの認証・設定で単一セッションを生成する。
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
	AgentSession,
	AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type * as PiSdk from "@earendil-works/pi-coding-agent";

/** Controllerが必要とするSDKの操作だけを公開する。 */
export type PiSession = Pick<
	AgentSession,
	"sessionId" | "model" | "subscribe" | "prompt" | "abort" | "dispose"
>;
export type { AgentSessionEvent as PiEvent };

/** 実SDKとテスト接続を同じ寿命管理で扱う。 */
export type PiFactory = (
	signal: AbortSignal,
) => Promise<{ session: PiSession; cwd: string }>;

/** 通常実行と隔離した疎通テストで使う起動条件。 */
export type PiRuntimeOptions = {
	extensionPath: string;
	cwd: string;
	agentDir?: string;
	provider?: string;
	model?: string;
	signal: AbortSignal;
};

/** 履歴はメモリ内、ツールと自動ロードは最小疎通の範囲に固定する。 */
export async function createPiRuntime(
	options: PiRuntimeOptions,
): Promise<PiSession> {
	const sdkUrl = pathToFileURL(
		join(
			options.extensionPath,
			"dist/runtime/node_modules/@earendil-works/pi-coding-agent/dist/bundle/index.js",
		),
	).href;
	const sdk = (await import(sdkUrl)) as typeof PiSdk;
	options.signal.throwIfAborted();
	const agentDir = options.agentDir || sdk.getAgentDir();
	const settingsManager = sdk.SettingsManager.create(options.cwd, agentDir);
	// パッケージの自動取得・拡張の実行と自動リトライを初期疎通から切り離す。
	settingsManager.applyOverrides({
		packages: [],
		extensions: [],
		skills: [],
		prompts: [],
		themes: [],
		compaction: { enabled: false },
		retry: { enabled: false, provider: { maxRetries: 0 } },
		cacheWarming: "off",
	});
	const resourceLoader = new sdk.DefaultResourceLoader({
		cwd: options.cwd,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
	});
	await resourceLoader.reload();
	options.signal.throwIfAborted();
	const modelRuntime = await sdk.ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: join(agentDir, "models.json"),
		modelsStorePath: join(agentDir, "models-cache.json"),
		signal: options.signal,
	});
	const provider = options.provider?.trim();
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
	const { session } = await sdk.createAgentSession({
		cwd: options.cwd,
		agentDir,
		settingsManager,
		resourceLoader,
		modelRuntime,
		...(model ? { model } : {}),
		sessionManager: sdk.SessionManager.inMemory(options.cwd),
		tools: ["read", "ls"],
	});
	if (options.signal.aborted || !session.model) {
		session.dispose();
		options.signal.throwIfAborted();
		throw new Error(
			"Piの認証・モデルを設定してください。Pi CLIのログイン、またはproviderのAPIキーを設定後に再接続してください。",
		);
	}
	return session;
}
