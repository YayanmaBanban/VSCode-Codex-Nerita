// 非公開usage APIの変化・失敗・取消がチャットや認証値の公開へ波及しないことを検証する。
import { normalizeCodexQuota } from "../../src/extension/backends/pi/codex/CodexQuotaService";
import { describe, expect, it, vi } from "vitest";
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { PiQuotaService } from "../../src/extension/backends/pi/PiQuotaService";
import { piHarness, pending } from "./piHarness";
import type { PiAccount } from "../../src/extension/backends/pi/PiAccount";

import { type HostMessage } from "@/shared/messages";

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
	it.each([
		["gpt-5.6-luna", "openai-codex/gpt-6-astra", true],
		["gpt-6-astra", "openai-codex/gpt-5.6-luna", true],
		["gpt-6-astra", "openai-codex/gpt-5.3-codex-spark", false],
		["gpt-5.3-codex-spark", "openai-codex/gpt-6-astra", false],
		["gpt-6-astra", "google/gpt-6-astra", false],
	])("%sから%sへの利用枠保持は%s", (id, next, retain) => {
		const session = { model: { provider: "openai-codex", id } };
		const service = new PiQuotaService(
			{} as unknown as ModelRuntime,
			session as unknown as AgentSession,
		);
		expect(service.canRetainForModel(next)).toBe(retain);
	});
	it("独自providerは利用枠グループを指定でき、未指定ならモデル変更時に破棄する", () => {
		const session = { model: { provider: "custom", id: "team/a" } };
		const models = {} as unknown as ModelRuntime;
		const sdk = session as unknown as AgentSession;
		const custom = new PiQuotaService(models, sdk, fetch, {
			custom: { quotaGroup: (id) => id.split("/")[0]! },
		});
		expect(custom.canRetainForModel("custom/team/b")).toBe(true);
		expect(custom.canRetainForModel("custom/other/c")).toBe(false);
		const fallback = new PiQuotaService(models, sdk, fetch, {});
		expect(fallback.canRetainForModel("custom/team/b")).toBe(false);
		expect(fallback.canRetainForModel("custom/team/a")).toBe(true);
	});
	it.each([
		["fast-mode", true],
		["reasoning_effort", true],
		["model", false],
		["model", true],
		["provider", false],
	] as const)(
		"%s変更中と再取得待ちの利用枠を取得元に応じて保持する",
		async (configId, keep) => {
			const h = piHarness();
			const quota = normalizeCodexQuota(payload);
			const update = pending<void>();
			const refresh = pending<typeof quota>();
			const read = vi
				.fn()
				.mockResolvedValueOnce(quota)
				.mockImplementationOnce(() => refresh.promise);
			h.runtime.quota = {
				read,
				canRetainForModel: () => keep,
			} as unknown as PiQuotaService;
			h.runtime.account = {
				refreshCatalog: () => Promise.resolve(),
				snapshot: () => ({
					connection: "ready",
					configOptions: [
						{
							id: configId,
							name: configId,
							currentValue: "off",
							options: [
								{ value: "off", name: "Off" },
								{ value: "on", name: "On" },
							],
						},
					],
				}),
				configure: () => update.promise,
			} as unknown as PiAccount;
			await h.controller.connect();
			await Promise.resolve();
			expect(h.controller.snapshot().quota).toEqual(quota);
			h.events.length = 0;
			const operation = h.controller.receive({
				type: "config/set",
				requestId: "toggle",
				sessionId: "pi-1",
				configId,
				value: "on",
			});
			expect(h.controller.snapshot().quota).toEqual(keep ? quota : null);
			update.resolve();
			await operation;
			expect(read).toHaveBeenCalledTimes(2);
			expect(h.controller.snapshot().quota).toEqual(keep ? quota : null);
			if (keep) {
				expectQuotaPreserved(h);
			}
			refresh.resolve([{ label: "5h", remaining: 60, detail: "" }]);
			await Promise.resolve();
			expect(h.controller.snapshot().quota?.[0]?.remaining).toBe(60);
			await h.controller.dispose();
		},
	);
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

/** 更新通知でも使用枠が消去されないことを確認する。 */
function expectQuotaPreserved(h: { events: HostMessage[] }) {
	for (const event of h.events) {
		if (event.type === "state/patch") {
			expect(event.patch.quota).not.toBeNull();
			if (event.patch.uiContributions) {
				expect(
					event.patch.uiContributions.items.some(
						(item) => item.control.type === "quota",
					),
				).toBe(true);
			}
		}
	}
}
