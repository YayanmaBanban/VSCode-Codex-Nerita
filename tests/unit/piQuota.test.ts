// 非公開 `usage` API の変化・失敗・取消がチャットや認証値の公開へ波及しないことを検証する。
import { normalizeOpenAIQuota } from "../../apps/vscode-nerita/src/extension/backends/pi/openai/OpenAIQuotaService";
import { describe, expect, it, vi } from "vitest";
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { PiQuotaService } from "../../apps/vscode-nerita/src/extension/backends/pi/PiQuotaService";
import { piHarness, pending } from "./piHarness";
import type { PiAccount } from "../../apps/vscode-nerita/src/extension/backends/pi/PiAccount";

import { type HostMessage } from "@nerita/shared/messages";
import { piProviders } from "../../apps/vscode-nerita/src/extension/backends/pi/PiProviders";
import { openAICodexQuota } from "../../apps/vscode-nerita/src/extension/backends/pi/openai/OpenAICodexQuota";
import { CodexClient } from "../../apps/vscode-nerita/src/extension/backends/codex/CodexClient";

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

/** JWT は外部送信しないテスト専用値。`fetch` も必ず差し替える。 */
function fixture() {
	const token = `test.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "account-test" } })).toString("base64url")}.signature`;
	const models = {
		isUsingOAuth: vi.fn(() => true),
		getAuth: vi.fn(() => Promise.resolve({ auth: { apiKey: token } })),
		checkAuth: vi.fn(() => Promise.resolve({ type: "oauth" })),
	};
	const session = {
		model: {
			provider: "openai",
			api: "openai-responses",
			baseUrl: "https://api.openai.com/v1",
		},
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
	it.each(["success", "signed-out", "failure"])(
		"Codex 補助取得 %s で接続を回収し、出所を保持する",
		async (mode) => {
			const dispose = vi.fn(() => Promise.resolve());
			const readRateLimits = vi.fn(() =>
				mode === "failure"
					? Promise.reject(new Error("private"))
					: Promise.resolve([
							{ label: "Weekly", remaining: 43, detail: "reset" },
						]),
			);
			const connect = vi.spyOn(CodexClient, "connect").mockResolvedValue({
				readAccount: () =>
					Promise.resolve({
						authenticated: mode !== "signed-out",
						requiresOpenaiAuth: true,
					}),
				readRateLimits,
				dispose,
			} as unknown as CodexClient);
			try {
				const signal = new AbortController().signal;
				const result = await openAICodexQuota(
					"fixture-extension",
					"fixture-workspace",
					signal,
				).read(signal);
				if (mode === "success") {
					expect(result?.[0]).toMatchObject({
						remaining: 43,
						detail: "reset",
						source: "codex-login",
					});
				} else {
					expect(result).toBeNull();
				}
				expect(readRateLimits).toHaveBeenCalledTimes(
					mode === "signed-out" ? 0 : 1,
				);
				expect(dispose).toHaveBeenCalledTimes(1);
			} finally {
				connect.mockRestore();
			}
		},
	);
	it("新 OAuth が拒否された場合は注入した Codex 取得元を使い、遅い応答を破棄する", async () => {
		const h = fixture();
		h.request.mockResolvedValue(new Response(null, { status: 401 }));
		const windows = [
			{
				label: "Weekly",
				remaining: 43,
				detail: "Codex ログインから取得",
			},
		];
		const read = vi.fn(() => Promise.resolve(windows));
		const service = new PiQuotaService(
			h.models as unknown as ModelRuntime,
			h.session as unknown as AgentSession,
			h.request,
			piProviders,
			{ read },
		);
		expect(await service.read(new AbortController().signal)).toEqual(
			windows,
		);
		h.models.isUsingOAuth.mockReturnValue(false);
		expect(await service.read(new AbortController().signal)).toBeNull();
		expect(read).toHaveBeenCalledTimes(1);
		h.models.isUsingOAuth.mockReturnValue(true);
		read.mockImplementationOnce(() => {
			h.session.model.provider = "google";
			return Promise.resolve(windows);
		});
		expect(await service.read(new AbortController().signal)).toBeNull();
		h.session.model.provider = "openai";
		const abort = new AbortController();
		read.mockImplementationOnce(() => {
			abort.abort();
			return Promise.resolve(windows);
		});
		expect(await service.read(abort.signal)).toBeNull();
	});
	it.each([
		["gpt-5.6-luna", "openai/gpt-6-astra", false],
		["gpt-6-astra", "openai/gpt-5.6-luna", false],
		["gpt-6-astra", "openai/gpt-6-astra", true],
		["gpt-6-astra", "openai/gpt-5.3-codex-spark", false],
		["gpt-5.3-codex-spark", "openai/gpt-6-astra", false],
		["gpt-6-astra", "google/gpt-6-astra", false],
	])("%sから%sへの利用枠保持は%s", (id, next, retain) => {
		const session = { model: { provider: "openai", id } };
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
			const quota = normalizeOpenAIQuota(payload);
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
				baseUrl: "https://example.invalid",
			};
			return Promise.resolve(Response.json(payload));
		});
		expect(await h.service.read(new AbortController().signal)).toBeNull();
	});
	it("時間枠を検証し残率へ変換、秘密値・creditsの生データは除外する", () => {
		const result = normalizeOpenAIQuota(payload);
		expect(result).toMatchObject([
			{ label: "5h", remaining: 68 },
			{ label: "Weekly", remaining: 82 },
		]);
		expect(JSON.stringify(result)).not.toMatch(/never-publish|secret-data/);
		expect(
			normalizeOpenAIQuota({
				rate_limit: {
					primary_window: {
						used_percent: NaN,
						limit_window_seconds: 18000,
					},
				},
			}),
		).toBeNull();
		expect(
			normalizeOpenAIQuota({
				rate_limit: {
					primary_window: {
						used_percent: 120,
						limit_window_seconds: 18000,
					},
				},
			})![0]!.remaining,
		).toBe(0);
		expect(normalizeOpenAIQuota({ unknown: true })).toBeNull();
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
				h.models.getAuth.mockResolvedValue({
					auth: { apiKey: "opaque-new-oauth" },
				});
				h.request.mockResolvedValue(
					Response.json(
						{
							error: {
								code: "no_matching_rule",
								type: "rejected_by_access_enforcement",
								message: h.token,
							},
						},
						{ status: 401 },
					),
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
			if (kind === "http") {
				expect(h.request).toHaveBeenCalledTimes(1);
				expect(h.request.mock.calls[0]![1]?.headers).toEqual({
					Authorization: "Bearer opaque-new-oauth",
					Accept: "application/json",
				});
				expect(h.models.getAuth).toHaveBeenCalledTimes(1);
				expect(h.models.getAuth).toHaveBeenCalledWith(
					"openai",
					expect.any(Object),
				);
			}
		},
	);
	it("切断後に遅れて到着した利用枠を新しい画面へ公開しない", async () => {
		const h = piHarness();
		const wait = pending<ReturnType<typeof normalizeOpenAIQuota>>();
		let signal: AbortSignal | undefined;
		h.runtime.quota = {
			read: (incoming: AbortSignal) => {
				signal = incoming;
				return wait.promise;
			},
		} as unknown as PiQuotaService;
		await h.controller.connect();
		h.controller.invalidate();
		wait.resolve(normalizeOpenAIQuota(payload));
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
