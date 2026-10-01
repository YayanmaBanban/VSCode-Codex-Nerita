// 公開モデルの順序・認証変更・失敗復帰・古い応答の破棄を検証する。
import { describe, expect, it, vi } from "vitest";
import { normalizeOpenAIModels } from "../../apps/vscode-nerita/src/extension/backends/pi/openai/OpenAIModelCatalog";
import { catalogHarness, liveModel } from "./piCatalogHarness";
import { PiAccount } from "../../apps/vscode-nerita/src/extension/backends/pi/PiAccount";
import { pending, piHarness } from "./piHarness";

describe("OpenAI ChatGPT model catalog", () => {
	it("表示済みのモデル切替は SDK とライブ一覧の再取得を待たない", async () => {
		const h = catalogHarness();
		await h.account.refreshCatalog(h.signal);
		h.request.mockClear();
		h.models.getAvailable.mockClear();
		h.request.mockRejectedValue(new Error("再取得を行わない"));
		h.models.getAvailable.mockRejectedValue(new Error("再取得を行わない"));
		await h.account.selectModel("openai/small", h.signal);
		expect(h.session.model.id).toBe("small");
		expect(h.request).not.toHaveBeenCalled();
		expect(h.models.getAvailable).not.toHaveBeenCalled();
	});
	it("版付きライブ一覧の GPT-6.1-Sol を選べ、一覧にない旧モデルを除く", async () => {
		const h = catalogHarness();
		h.all[1] = { ...h.all[1]!, id: "gpt-6.1-sol", name: "GPT-6.1-Sol" };
		h.request.mockImplementation((url) =>
			Promise.resolve(
				Response.json({
					models:
						url ===
						"https://api.openai.com/v1/models?client_version=0.999.0"
							? [...h.payload.models, liveModel("gpt-6.1-sol")]
							: h.payload.models,
				}),
			),
		);
		await h.account.refreshCatalog(h.signal);
		await h.account.selectModel("openai/gpt-6.1-sol", h.signal);
		expect(h.session.model.id).toBe("gpt-6.1-sol");
	});
	it("公開順・表示名・visibility を反映し、SDK にないモデルを追加しない", async () => {
		const h = catalogHarness();
		await h.account.refreshCatalog(h.signal);
		expect(h.account.snapshot().configOptions![0]!.options).toEqual([
			{ value: "openai/small", name: "Live small" },
			{ value: "openai/astra", name: "Live astra" },
		]);
		for (const id of ["hidden", "spark", "not-in-pi"]) {
			await expect(
				h.account.selectModel(`openai/${id}`, h.signal),
			).rejects.toThrow();
		}
		expect(h.session.setModel).not.toHaveBeenCalled();
		h.session.model = h.all[4]!;
		await h.account.selectProvider("openai", h.signal);
		expect(h.session.model.id).toBe("small");
	});
	it.each([
		[["high", "xhigh", "max", "ultra"], "xhigh", "xhigh"],
		[["high", "max", "ultra"], null, "max"],
		[["low", "high", "ultra"], null, "high"],
		[["high", "max", "ultra"], "unknown", "max"],
		[["high", "max", "ultra"], "ultra", "max"],
		[["high", "xhigh", "max"], "xhigh", undefined],
		[["ultra"], null, undefined],
	] as const)(
		"ライブ候補 %j と委譲用値 %s から Ultra の実推論値 %s を解決する",
		(efforts, preferred, expected) => {
			const catalog = normalizeOpenAIModels({
				models: [
					liveModel("astra", {
						supported_reasoning_levels: efforts.map((effort) => ({
							effort,
						})),
						multi_agent_reasoning_effort: preferred,
					}),
				],
			});
			expect(catalog?.[0]?.ultraEffort).toBe(expected);
		},
	);
	it.each([
		null,
		{},
		[{ effort: "ultra" }, { effort: 1 }],
		Array(33).fill({ effort: "ultra" }),
	])(
		"不正な能力欄 %j は Ultra を公開せず基本のモデル一覧を保持する",
		(entries) => {
			const catalog = normalizeOpenAIModels({
				models: [
					liveModel("astra", { supported_reasoning_levels: entries }),
				],
			});
			expect(catalog?.[0]?.slug).toBe("astra");
			expect(catalog?.[0]?.ultraEffort).toBeUndefined();
		},
	);
	it("ライブカタログの優先処理を Fast として公開し、通常推論は SDK に従う", async () => {
		const h = catalogHarness();
		h.payload.models[1] = liveModel("astra", {
			supported_reasoning_levels: [{ effort: "ultra" }],
			service_tiers: [{ id: "priority" }],
			additional_speed_tiers: ["fast"],
		});
		await h.account.refreshCatalog(h.signal);
		expect(h.account.controls.reasoningOptions.map((o) => o.value)).toEqual(
			h.all[0]!.levels,
		);
		expect(h.account.controls.configOptions).toMatchObject([
			{ id: "fast-mode", currentValue: "off" },
		]);
		expect(h.session.thinkingLevel).toBe("minimal");
	});
	it("隠れた履歴モデルは選び直し、空のライブ一覧では別プロバイダーへ復帰する", async () => {
		const h = catalogHarness();
		h.session.model = h.all[2]!;
		await h.account.refreshCatalog(h.signal);
		expect(h.session.model.id).toBe("small");
		h.payload.models = [];
		await h.account.refreshCatalog(h.signal);
		expect(h.session.model.provider).toBe("local");
		await expect(
			h.account.selectProvider("openai", h.signal),
		).rejects.toThrow();
	});
	it("初回失敗は SDK 候補を維持し、同じ認証の成功一覧は通信失敗後も使う", async () => {
		const h = catalogHarness();
		h.request.mockRejectedValueOnce(new Error("private failure"));
		await h.account.refreshCatalog(h.signal);
		expect(
			h.account
				.snapshot()
				.configOptions![0]!.options.map((option) => option.value),
		).toEqual([
			"openai/astra",
			"openai/spark",
			"openai/hidden",
			"openai/small",
		]);
		await h.account.refreshCatalog(h.signal);
		h.request.mockRejectedValueOnce(new Error("private failure"));
		await h.account.refreshCatalog(h.signal);
		expect(h.account.snapshot().configOptions![0]!.options).toEqual([
			{ value: "openai/small", name: "Live small" },
			{ value: "openai/astra", name: "Live astra" },
		]);
		expect(JSON.stringify(h.account.snapshot())).not.toMatch(
			/fixture-account|test-secret|private failure/,
		);
	});
	it("認証変更では前のキャッシュを破棄し、旧 credential をコピーしない", async () => {
		const h = catalogHarness();
		const login = vi.fn(() => Promise.resolve());
		Object.assign(h.models, {
			getProviders: () => [
				{ id: "openai", name: "OpenAI", auth: { oauth: {} } },
			],
			listCredentials: () =>
				Promise.resolve([
					{ providerId: "openai-codex", type: "oauth" },
				]),
			login,
		});
		const account = new PiAccount(
			h.sdkModels,
			h.sdkSession,
			{
				manage: async (_items, execute, signal) => {
					await execute(JSON.stringify(["openai", "oauth"]), signal);
				},
				interaction: (signal) => ({
					signal,
					prompt: () => Promise.resolve("test"),
					notify: () => {},
				}),
			},
			undefined,
			h.catalog,
			undefined,
			undefined,
			undefined,
			() => Promise.resolve("stable-id"),
		);
		await account.refreshCatalog(h.signal);
		h.request.mockRejectedValue(new Error("private"));
		await account.authenticate(false, h.signal);
		expect(
			account
				.snapshot()
				.configOptions![0]!.options.map((option) => option.value),
		).toEqual([
			"openai/astra",
			"openai/spark",
			"openai/hidden",
			"openai/small",
		]);
		const opts = login.mock.calls[0] as unknown as [
			string,
			string,
			unknown,
			{ getDeviceId: () => string },
		];
		expect(opts[0]).toBe("openai");
		expect(opts[3].getDeviceId()).toBe("stable-id");
	});
	it.each(["provider", "account"] as const)(
		"変更 %s 後の遅れた一覧を破棄する",
		async (change) => {
			const h = catalogHarness(),
				wait = pending<Response>();
			h.request.mockImplementationOnce(() => wait.promise);
			const running = h.catalog.refresh("openai", h.signal);
			await vi.waitFor(() => expect(h.request).toHaveBeenCalled());
			if (change === "provider") {
				h.session.model = h.all[4]!;
			} else {
				h.catalog.invalidate();
			}
			wait.resolve(Response.json(h.payload));
			await running;
			expect(h.catalog.snapshot("openai")).toBeNull();
		},
	);
	it("接続待ちを切断した後に状態を戻さない", async () => {
		const h = catalogHarness(),
			controller = piHarness(),
			wait = pending<Response>();
		controller.runtime.account = h.account;
		h.request.mockImplementationOnce(() => wait.promise);
		const opening = controller.controller.connect();
		await vi.waitFor(() => expect(h.request).toHaveBeenCalled());
		controller.controller.invalidate();
		wait.resolve(Response.json(h.payload));
		await opening;
		expect(controller.controller.snapshot().connection).toBe(
			"disconnected",
		);
		await controller.controller.dispose();
	});
	it("API キーの data 形式・不正な公開状態・重複を拒否する", () => {
		for (const value of [
			null,
			{},
			{ data: [{ id: "test" }] },
			{ models: [{}] },
			{ models: [liveModel(), liveModel()] },
			{ models: [liveModel("x", { visibility: "unknown" })] },
		]) {
			expect(normalizeOpenAIModels(value)).toBeNull();
		}
		expect(normalizeOpenAIModels({ models: [] })).toEqual([]);
	});
});
