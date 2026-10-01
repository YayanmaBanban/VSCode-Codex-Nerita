// SDK の認証・モデル切替と、公開 API の応答を模擬する。
import { vi } from "vitest";
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { PiAccount } from "../../apps/vscode-nerita/src/extension/backends/pi/PiAccount";
import { PiModelCatalogService } from "../../apps/vscode-nerita/src/extension/backends/pi/PiModelCatalogService";

/** サーバーの配列順を維持する公開モデル情報。 */
export function liveModel(slug = "astra", extra: Record<string, unknown> = {}) {
	return { slug, display_name: `Live ${slug}`, visibility: "list", ...extra };
}
/** 実トークンを読み込まず、SDK に返す OAuth 形式だけを模擬する。 */
export function oauthToken(account = "fixture-account") {
	return `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: account }, scope: "chatgpt.tokens.use.direct" })).toString("base64url")}.test-secret`;
}
/** 現在モデルとは別に、各モデルの SDK 推論候補を保持する。 */
export function catalogHarness() {
	const all = ["astra", "spark", "hidden", "small"].map((id) => ({
		provider: "openai",
		id,
		name: `Static ${id}`,
		api: "openai-responses",
		baseUrl: "https://api.openai.com/v1",
		thinkingLevelMap: {
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
			max: "max",
		},
		levels:
			id === "small"
				? ["low"]
				: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
	}));
	all.push({
		...all[0]!,
		provider: "local",
		id: "local",
		name: "Local",
		api: "openai-completions",
		levels: ["off"],
	});
	const session = {
		model: all[0]!,
		thinkingLevel: "minimal",
		getAvailableThinkingLevels: () => session.model.levels,
		setThinkingLevel: vi.fn((value: string) => {
			session.thinkingLevel = value;
		}),
		setModel: vi.fn((model: (typeof all)[number]) => {
			session.model = model;
			if (!model.levels.includes(session.thinkingLevel)) {
				session.thinkingLevel = model.levels[0]!;
			}
			return Promise.resolve();
		}),
	};
	const models = {
		getAvailable: vi.fn(() => Promise.resolve(all)),
		getAvailableSnapshot: () => all,
		getProviderAuthStatus: () => ({ configured: true }),
		isUsingOAuth: (provider: string): boolean => provider === "openai",
		getAuth: vi.fn(() =>
			Promise.resolve({ auth: { apiKey: oauthToken() } }),
		),
		checkAuth: vi.fn(() => Promise.resolve({ type: "oauth" })),
	};
	const payload = {
		models: [
			liveModel("small"),
			liveModel(),
			liveModel("hidden", { visibility: "hide" }),
			liveModel("not-in-pi"),
		],
	};
	const request = vi.fn<typeof fetch>(() =>
		Promise.resolve(Response.json(payload)),
	);
	const sdkModels = models as unknown as ModelRuntime;
	const sdkSession = session as unknown as AgentSession;
	const catalog = new PiModelCatalogService(sdkModels, sdkSession, request);
	const account = new PiAccount(
		sdkModels,
		sdkSession,
		undefined,
		undefined,
		catalog,
		undefined,
		undefined,
		(model) =>
			all.find(
				(item) =>
					item.provider === model.provider && item.id === model.id,
			)?.levels ?? [],
	);
	return {
		all,
		session,
		models,
		sdkModels,
		sdkSession,
		payload,
		request,
		catalog,
		account,
		signal: new AbortController().signal,
	};
}
