// 非公開usage APIの変化・失敗・取消がチャットや認証値の公開へ波及しないことを検証する。
import { normalizeCodexQuota } from "../../src/extension/backends/pi/codex/CodexQuotaService";
import { describe, expect, it, vi } from "vitest";
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { PiQuotaService } from "../../src/extension/backends/pi/PiQuotaService";
import { piHarness, pending } from "./piHarness";

const payload = {
	rate_limit: {
		primary_window: {
			used_percent: 32,
			limit_window_seconds: 18000,
			reset_at: 1800000000,
		},
		secondary_window: { used_percent: 18, limit_window_seconds: 604800 },
	},
	account_id: "never-publish",
	credits: { balance: "secret-data" },
};

/** JWTは外部送信しないテスト専用値。fetchも必ず差し替える。 */
function fixture() {
	const token = `test.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "account-test" } })).toString("base64url")}.signature`;
	const models = {
		isUsingOAuth: vi.fn(() => true),
		getAuth: vi.fn(() => Promise.resolve({ auth: { apiKey: token } })),
		checkAuth: vi.fn(() => Promise.resolve({ type: "oauth" })),
	};
	const session = {
		model: { provider: "openai-codex", api: "openai-codex-responses" },
	};
	const request = vi.fn<typeof fetch>(() =>
		Promise.resolve(Response.json(payload)),
	);
	const service = new PiQuotaService(
		models as unknown as ModelRuntime,
		session as unknown as AgentSession,
		request,
	);
	return { token, models, session, request, service };
}

describe("Pi quota", () => {
	it("SDK内部でproviderが変わった場合も古い応答を採用しない", async () => {
		const h = fixture();
		h.request.mockImplementation(() => {
			h.session.model = {
				provider: "google",
				api: "google-generative-ai",
			};
			return Promise.resolve(Response.json(payload));
		});
		expect(await h.service.read(new AbortController().signal)).toBeNull();
	});
	it("時間枠を検証し残率へ変換、秘密値・creditsの生データは除外する", () => {
		const result = normalizeCodexQuota(payload);
		expect(result).toMatchObject([
			{ label: "5h", remaining: 68 },
			{ label: "Weekly", remaining: 82 },
		]);
		expect(JSON.stringify(result)).not.toMatch(/never-publish|secret-data/);
		expect(
			normalizeCodexQuota({
				rate_limit: {
					primary_window: {
						used_percent: NaN,
						limit_window_seconds: 18000,
					},
				},
			}),
		).toBeNull();
		expect(
			normalizeCodexQuota({
				rate_limit: {
					primary_window: {
						used_percent: 120,
						limit_window_seconds: 18000,
					},
				},
			})![0]!.remaining,
		).toBe(0);
		expect(normalizeCodexQuota({ unknown: true })).toBeNull();
	});
	it("OAuthをSDKで解決し固定宛先・redirect禁止・Host限定headerで取得する", async () => {
		const h = fixture();
		expect(await h.service.read(new AbortController().signal)).toHaveLength(
			2,
		);
		const [url, init] = h.request.mock.calls[0]!;
		expect(url).toBe("https://chatgpt.com/backend-api/wham/usage");
		expect(init?.redirect).toBe("error");
		expect(init?.headers).toMatchObject({
			Authorization: `Bearer ${h.token}`,
			"ChatGPT-Account-Id": "account-test",
		});
	});
	it("APIキー・他providerでは外部取得しない", async () => {
		const h = fixture();
		h.models.isUsingOAuth.mockReturnValue(false);
		expect(await h.service.read(new AbortController().signal)).toBeNull();
		h.models.isUsingOAuth.mockReturnValue(true);
		h.session.model.provider = "google";
		expect(await h.service.read(new AbortController().signal)).toBeNull();
		expect(h.models.getAuth).not.toHaveBeenCalled();
		expect(h.request).not.toHaveBeenCalled();
	});
	it("認証解決後にAPIキーへ変わっていた場合も送信しない", async () => {
		const h = fixture();
		h.models.checkAuth.mockResolvedValue({ type: "api_key" });
		expect(await h.service.read(new AbortController().signal)).toBeNull();
		expect(h.request).not.toHaveBeenCalled();
	});
	it.each(["http", "json", "network", "abort"])(
		"%s失敗はnullのみを返す",
		async (kind) => {
			const h = fixture();
			if (kind === "http") {
				h.request.mockResolvedValue(
					new Response(h.token, { status: 401 }),
				);
			}
			if (kind === "json") {
				h.request.mockResolvedValue(new Response(h.token));
			}
			if (kind === "network") {
				h.request.mockRejectedValue(new Error(h.token));
			}
			expect(
				await h.service.read(
					kind === "abort"
						? AbortSignal.abort()
						: new AbortController().signal,
				),
			).toBeNull();
		},
	);
	it("切断後に遅れて到着した利用枠を新しい画面へ公開しない", async () => {
		const h = piHarness();
		const wait = pending<ReturnType<typeof normalizeCodexQuota>>();
		let signal: AbortSignal | undefined;
		h.runtime.quota = {
			read: (incoming: AbortSignal) => {
				signal = incoming;
				return wait.promise;
			},
		} as unknown as PiQuotaService;
		await h.controller.connect();
		h.controller.invalidate();
		wait.resolve(normalizeCodexQuota(payload));
		await Promise.resolve();
		expect(signal?.aborted).toBe(true);
		expect(h.controller.snapshot().quota).toBeNull();
		await h.controller.dispose();
	});
});
