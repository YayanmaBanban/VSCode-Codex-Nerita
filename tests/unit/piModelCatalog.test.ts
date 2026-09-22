// live候補とHost側の全選択経路・Reasoning能力・取消競合を検証する。
import { describe, expect, it } from "vitest";
import { normalizeCodexModels } from "../../src/extension/backends/pi/codex/CodexModelCatalog";
import { catalogHarness, liveModel } from "./piCatalogHarness";
import { pending, piHarness } from "./piHarness";
import { PiAccount } from "../../src/extension/backends/pi/PiAccount";
import { validComposerField } from "../../src/shared/composerValidation";
import { PiQuotaService } from "../../src/extension/backends/pi/PiQuotaService";

describe("Pi live model catalog", () => {
	it("catalog失敗後もQuotaと送信は独立して動く", async () => {
		const h = catalogHarness();
		h.request.mockRejectedValue(new Error("private catalog failure"));
		const controller = piHarness();
		controller.runtime.account = h.account;
		controller.runtime.quota = new PiQuotaService(
			h.sdkModels,
			h.sdkSession,
			fetch,
			{
				"openai-codex": {
					createQuota: () => ({
						read: () =>
							Promise.resolve([
								{ label: "5h", remaining: 50, detail: "" },
							]),
					}),
				},
			},
		);
		await controller.controller.connect();
		await controller.send();
		expect(controller.runtime.prompt).toHaveBeenCalled();
		expect(controller.controller.snapshot().quota?.[0]?.remaining).toBe(50);
		expect(JSON.stringify(controller.events)).not.toContain(
			"private catalog failure",
		);
		await controller.controller.dispose();
	});

	it("同じモデルのcatalog更新でUltra基底が変わっても有効なoverrideを維持する", async () => {
		const h = catalogHarness();
		await h.account.refreshCatalog(h.signal);
		h.account.selectThinkingLevel("ultra", h.signal);
		h.payload.models[0]!.supported_reasoning_levels = [
			{ effort: "high", description: "" },
			{ effort: "ultra", description: "" },
		];
		await h.account.refreshCatalog(h.signal);
		expect(h.account.snapshot().piProviderControls).toMatchObject({
			thinkingLevel: "high",
			effectiveReasoning: "ultra",
		});
	});
	it("非対応の現在値をlive default Ultraへ補正する", async () => {
		const h = catalogHarness();
		h.payload.models[0]!.default_reasoning_level = "ultra";
		await h.account.refreshCatalog(h.signal);
		expect(h.account.snapshot().piProviderControls).toMatchObject({
			thinkingLevel: "max",
			effectiveReasoning: "ultra",
		});
	});
	it("再ログインは同一accountでも成功cacheを破棄し、失敗時に候補を復活させない", async () => {
		const h = catalogHarness();
		Object.assign(h.models, {
			getProviders: () => [
				{ id: "openai-codex", name: "Codex", auth: { oauth: {} } },
			],
			listCredentials: () =>
				Promise.resolve([
					{ providerId: "openai-codex", type: "oauth" },
				]),
			login: () => Promise.resolve(),
		});
		const account = new PiAccount(
			h.sdkModels,
			h.sdkSession,
			{
				manage: async (_items, execute, signal) => {
					await execute(
						JSON.stringify(["openai-codex", "oauth"]),
						signal,
					);
				},
				interaction: (signal) => ({
					signal,
					prompt: () => Promise.resolve("fixture"),
					notify: () => {},
				}),
			},
			undefined,
			h.catalog,
		);
		await account.refreshCatalog(h.signal);
		expect(account.snapshot().configOptions![0]!.options).toHaveLength(2);
		h.request.mockRejectedValue(new Error("secret"));
		await account.authenticate(false, h.signal);
		expect(
			account
				.snapshot()
				.configOptions![0]!.options.map((item) => item.value),
		).toEqual(["openai-codex/astra"]);
		expect(account.snapshot().connection).toBe("ready");
	});

	it("APIキーのstaticモデルからUltra・Fast対応を推測しない", () => {
		const h = catalogHarness();
		h.models.isUsingOAuth = () => false;
		const snapshot = h.account.snapshot();
		expect(snapshot.configOptions![0]!.options).toHaveLength(4);
		expect(
			snapshot.configOptions![1]!.options.some(
				(item) => item.value === "ultra",
			),
		).toBe(false);
		expect(
			snapshot.configOptions!.some((item) => item.id === "fast-mode"),
		).toBe(false);
	});
	it("live visibility・priority・表示名を使い、PiにないモデルとSparkを除く", async () => {
		const h = catalogHarness();
		await h.account.refreshCatalog(h.signal);
		const option = h.account.snapshot().configOptions![0]!;
		expect(option.options).toEqual([
			{ value: "openai-codex/small", name: "Live small" },
			{ value: "openai-codex/astra", name: "Live astra" },
		]);
		for (const id of ["spark", "hidden", "not-in-pi"]) {
			await expect(
				h.account.selectModel(`openai-codex/${id}`, h.signal),
			).rejects.toThrow();
		}
		expect(h.session.model.id).toBe("astra");
		await h.account.selectProvider("local", h.signal);
		await h.account.selectProvider("openai-codex", h.signal);
		expect(h.session.model.id).toBe("small");
	});

	it("hidden履歴は保持し、catalogに存在しない履歴はpriority先頭へ補正する", async () => {
		const h = catalogHarness();
		h.session.model = h.all[2]!;
		await h.account.refreshCatalog(h.signal);
		expect(h.session.model.id).toBe("hidden");
		expect(h.account.snapshot().configOptions![0]!.currentLabel).toBe(
			"Live hidden",
		);
		expect(
			validComposerField(
				"configOptions",
				h.account.snapshot().configOptions,
			),
		).toBe(true);
		expect(
			validComposerField("configOptions", [
				{
					...h.account.snapshot().configOptions![0],
					currentLabel: { secret: true },
				},
			]),
		).toBe(false);
		expect(h.session.setModel).not.toHaveBeenCalled();
		h.session.model = h.all[1]!;
		await h.account.refreshCatalog(h.signal);
		expect(h.session.model.id).toBe("small");
	});

	it("初回失敗は現在モデルだけ維持し、取得済みなら同一accountのcacheを使う", async () => {
		const h = catalogHarness();
		h.request.mockRejectedValueOnce(new Error("private HTTP body"));
		await h.account.refreshCatalog(h.signal);
		expect(h.account.snapshot().configOptions![0]!.options).toEqual([
			{ value: "openai-codex/astra", name: "Static astra" },
		]);
		expect(h.account.snapshot().connection).toBe("ready");
		expect(h.account.snapshot().configOptions![1]!.options).toEqual([]);
		await h.account.refreshCatalog(h.signal);
		h.request.mockRejectedValueOnce(new Error("private HTTP body"));
		await h.account.refreshCatalog(h.signal);
		expect(h.account.snapshot().configOptions![0]!.options).toHaveLength(2);
		expect(JSON.stringify(h.account.snapshot())).not.toMatch(
			/fixture-account|test-secret|private HTTP/,
		);
	});

	it("ReasoningはLive ∩ Piだけを表示し、default補正とUltra基底を適用する", async () => {
		const h = catalogHarness();
		await h.account.refreshCatalog(h.signal);
		expect(h.session.thinkingLevel).toBe("high");
		expect(
			h.account.snapshot().configOptions![1]!.options.map((o) => o.value),
		).toEqual(["low", "high", "max", "ultra"]);
		for (const level of ["off", "minimal", "medium", "persistent"]) {
			expect(() =>
				h.account.selectThinkingLevel(level, h.signal),
			).toThrow();
		}
		h.account.selectThinkingLevel("ultra", h.signal);
		h.account.controls.configure("fast-mode", "on", h.signal);
		expect(
			h.account.controls.rewrite(
				{ reasoning: { summary: "auto" }, extension: true },
				h.sdkSession.model,
			),
		).toEqual({
			reasoning: { summary: "auto", effort: "ultra" },
			extension: true,
			service_tier: "priority",
		});
		await h.account.selectModel("openai-codex/small", h.signal);
		expect(h.account.snapshot().piProviderControls).toMatchObject({
			effectiveReasoning: "low",
			reasoningOverride: null,
			fastMode: false,
		});
		expect(
			h.account
				.snapshot()
				.configOptions!.some((o) => o.id === "fast-mode"),
		).toBe(false);
	});

	it("none・minimalはliveとPi双方にあるときだけ表示する", async () => {
		const h = catalogHarness();
		h.payload.models = [
			liveModel("astra", {
				default_reasoning_level: "none",
				supported_reasoning_levels: [
					"none",
					"minimal",
					"xhigh",
					"persistent",
				].map((effort) => ({ effort })),
			}),
		];
		await h.account.refreshCatalog(h.signal);
		expect(
			h.account.snapshot().configOptions![1]!.options.map((o) => o.value),
		).toEqual(["off", "minimal"]);
		expect(h.session.thinkingLevel).toBe("minimal");
		h.session.thinkingLevel = "high";
		expect(
			h.account.snapshot().piProviderControls?.effectiveReasoning,
		).toBe("off");
	});

	it("maxとFastがなくてもlive Ultraを標準default基底で利用する", async () => {
		const h = catalogHarness();
		h.payload.models = [
			liveModel("astra", {
				service_tiers: [],
				supported_reasoning_levels: [
					{ effort: "high" },
					{ effort: "ultra" },
				],
			}),
		];
		await h.account.refreshCatalog(h.signal);
		h.account.selectThinkingLevel("ultra", h.signal);
		expect(h.account.snapshot().piProviderControls).toMatchObject({
			thinkingLevel: "high",
			effectiveReasoning: "ultra",
			fastMode: false,
		});
		expect(h.account.controls.rewrite({}, h.sdkSession.model)).toEqual({
			reasoning: { effort: "ultra" },
		});
	});

	it("provider変更・認証無効化後の旧応答を破棄する", async () => {
		for (const change of ["provider", "account"] as const) {
			const h = catalogHarness();
			const wait = pending<Response>();
			h.request.mockImplementationOnce(() => wait.promise);
			const operation = h.catalog.refresh("openai-codex", h.signal);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
			if (change === "provider") {
				h.session.model = h.all[4]!;
			} else {
				h.catalog.invalidate();
			}
			wait.resolve(Response.json(h.payload));
			await operation;
			expect(h.catalog.snapshot("openai-codex")).toBeNull();
		}
	});

	it("接続中catalog待機を切断し、古い接続から状態を戻さない", async () => {
		const h = catalogHarness();
		const controller = piHarness();
		controller.runtime.account = h.account;
		const wait = pending<Response>();
		h.request.mockImplementationOnce(() => wait.promise);
		const opening = controller.controller.connect();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		controller.controller.invalidate();
		wait.resolve(Response.json(h.payload));
		await opening;
		expect(controller.controller.snapshot().connection).toBe(
			"disconnected",
		);
		await controller.controller.dispose();
	});

	it("parserは不正schemaを拒否し、未知effortを公開しない", () => {
		for (const value of [
			null,
			{},
			{ models: [{}] },
			{ models: [liveModel(), liveModel()] },
			{ models: [liveModel("x", { visibility: "unknown" })] },
			{ models: [liveModel("x", { service_tiers: [null] })] },
		]) {
			expect(normalizeCodexModels(value)).toBeNull();
		}
		expect(
			normalizeCodexModels({
				models: [
					liveModel("x", {
						visibility: "none",
						supported_reasoning_levels: [
							{ effort: "persistent" },
							{ effort: "future" },
						],
					}),
				],
			})![0]!.reasoningLevels,
		).toEqual([]);
	});
});
