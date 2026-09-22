// OAuthとlive HTTPの境界だけを模擬し、実Hostの候補・設定処理を検証する。
import { vi } from "vitest";
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { PiAccount } from "../../src/extension/backends/pi/PiAccount";
import { PiModelCatalogService } from "../../src/extension/backends/pi/PiModelCatalogService";

/** live schemaの最小モデル。未使用項目もfixtureに置いて除外条件を検証する。 */
export function liveModel(slug = "astra", extra: Record<string, unknown> = {}) {
	return {
		slug,
		display_name: `Live ${slug}`,
		priority: 1,
		visibility: "list",
		default_reasoning_level: "high",
		supported_reasoning_levels: ["low", "high", "max", "ultra"].map(
			(effort) => ({ effort, description: effort }),
		),
		service_tiers: [
			{
				id: "priority",
				name: "Fast",
				description: "Live priority description",
			},
		],
		supported_in_api: false,
		...extra,
	};
}

/** 実認証情報を読まず、SDKのgetAuthが返す形式だけを再現する。 */
export function oauthToken(account = "fixture-account") {
	return `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: account } })).toString("base64url")}.test-secret`;
}

/** SDKのモデル切替・推論適用とOAuth account変更を操作可能にする。 */
export function catalogHarness() {
	const all = ["astra", "spark", "hidden", "small"].map((id) => ({
		provider: "openai-codex",
		id,
		name: `Static ${id}`,
		api: "openai-codex-responses",
		levels: ["off", "minimal", "low", "medium", "high", "max"],
	}));
	all.push({
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
		isUsingOAuth: (provider: string): boolean =>
			provider === "openai-codex",
		getAuth: vi.fn(() =>
			Promise.resolve({ auth: { apiKey: oauthToken() } }),
		),
		checkAuth: vi.fn(() => Promise.resolve({ type: "oauth" })),
	};
	const payload = {
		models: [
			liveModel(),
			liveModel("hidden", { visibility: "hide" }),
			liveModel("small", {
				priority: 0,
				default_reasoning_level: "low",
				supported_reasoning_levels: [{ effort: "low" }],
				service_tiers: [],
			}),
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
