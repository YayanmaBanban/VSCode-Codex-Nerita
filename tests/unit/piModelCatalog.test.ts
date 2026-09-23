// Pi候補と補助metadataの独立性、Reasoning能力、取消競合を検証する。
import { describe, expect, it } from "vitest";
import { normalizeCodexModels } from "../../src/extension/backends/pi/codex/CodexModelCatalog";
import { catalogHarness, liveModel } from "./piCatalogHarness";
import { pending, piHarness } from "./piHarness";
import { PiAccount } from "../../src/extension/backends/pi/PiAccount";
import { validComposerField } from "../../src/shared/composerValidation";
import { PiQuotaService } from "../../src/extension/backends/pi/PiQuotaService";

describe("Pi live model catalog", () => {
	it("provider切替前にliveを取得し、Pi先頭の非掲載Sparkを選ばない", async () => {
		const h = catalogHarness();
		h.session.model = h.all[4]!;
		const spark = h.all.splice(1, 1)[0]!;
		h.all.unshift(spark);
		await h.account.selectProvider("openai-codex", h.signal);
		expect(h.session.model.id).toBe("small");
	});

	it("空のlive catalogは成功として扱い、PiのCodex候補を再公開しない", async () => {
		const h = catalogHarness();
		h.payload.models = [];
		await h.account.refreshCatalog(h.signal);
		expect(h.session.model.provider).toBe("local");
		await expect(
			h.account.selectProvider("openai-codex", h.signal),
		).rejects.toThrow();
		await expect(
			h.account.selectModel("openai-codex/spark", h.signal),
		).rejects.toThrow();
	});

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

	it("liveの通常候補変更に合わせてUltra基底を更新する", async () => {
		const h = catalogHarness();
		await h.account.refreshCatalog(h.signal);
		await h.account.selectThinkingLevel("ultra", h.signal);
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
	it("live default Ultraだけでは現在の通常Reasoningを変更しない", async () => {
		const h = catalogHarness();
		h.payload.models[0]!.default_reasoning_level = "ultra";
		await h.account.refreshCatalog(h.signal);
		expect(h.account.snapshot().piProviderControls).toMatchObject({
			thinkingLevel: "minimal",
			effectiveReasoning: "minimal",
		});
	});
	it("再ログインは成功metadataを破棄するがPi候補は維持する", async () => {
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
		expect(account.snapshot().configOptions![0]!.options).toHaveLength(4);
		expect(account.snapshot().configOptions![0]!.options[0]?.name).toBe(
			"Static astra",
		);
		expect(
			account
				.snapshot()
				.configOptions![1]!.options.map((item) => item.value),
		).not.toContain("ultra");
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
	it("liveに無いSparkとhiddenを除外し、表示名とpriorityを反映する", async () => {
		const h = catalogHarness();
		await h.account.refreshCatalog(h.signal);
		const option = h.account.snapshot().configOptions![0]!;
		expect(option.options).toEqual([
			{ value: "openai-codex/small", name: "Live small" },
			{ value: "openai-codex/astra", name: "Live astra" },
		]);
		await expect(
			h.account.selectModel("openai-codex/spark", h.signal),
		).rejects.toThrow();
		await expect(
			h.account.selectModel("openai-codex/hidden", h.signal),
		).rejects.toThrow();
		await expect(
			h.account.selectModel("openai-codex/not-in-pi", h.signal),
		).rejects.toThrow();
		expect(h.session.model.id).toBe("astra");
		await h.account.selectProvider("local", h.signal);
		await h.account.selectProvider("openai-codex", h.signal);
		expect(h.session.model.id).toBe("small");
	});

	it("liveで選択不能な履歴モデルから利用可能モデルへ復帰する", async () => {
		const h = catalogHarness();
		h.session.model = h.all[2]!;
		await h.account.refreshCatalog(h.signal);
		expect(h.session.model.id).toBe("small");
		expect(h.account.snapshot().configOptions![0]!.currentLabel).toBe(
			"Live small",
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
		expect(h.session.setModel).toHaveBeenCalledOnce();
		h.session.model = h.all[1]!;
		await h.account.refreshCatalog(h.signal);
		expect(h.session.model.id).toBe("small");
		expect(h.account.snapshot().configOptions![0]!.currentLabel).toBe(
			"Live small",
		);
	});

	it("新モデルはlive掲載後に選択でき、visibility noneは除外する", async () => {
		const h = catalogHarness();
		h.payload.models[1]!.visibility = "none";
		await h.account.refreshCatalog(h.signal);
		h.all.push({ ...h.all[0]!, id: "new-pi-model", name: "New Pi Model" });
		const options = h.account.snapshot().configOptions![0]!.options;
		expect(options.map((item) => item.value)).not.toContain(
			"openai-codex/hidden",
		);
		expect(options).not.toContainEqual({
			value: "openai-codex/new-pi-model",
			name: "New Pi Model",
		});
		await expect(
			h.account.selectModel("openai-codex/new-pi-model", h.signal),
		).rejects.toThrow();
		h.payload.models.push(
			liveModel("new-pi-model", {
				service_tiers: [],
				supported_reasoning_levels: [{ effort: "high" }],
			}),
		);
		await h.account.selectModel("openai-codex/new-pi-model", h.signal);
		expect(
			h.account
				.snapshot()
				.configOptions![1]!.options.map((item) => item.value),
		).toEqual(["high"]);
		expect(
			h.account
				.snapshot()
				.configOptions!.some((item) => item.id === "fast-mode"),
		).toBe(false);
		expect(
			h.account
				.snapshot()
				.configOptions![1]!.options.map((item) => item.value),
		).not.toContain("ultra");
	});

	it("初回失敗でも全Pi候補と通常Reasoningを維持し、成功metadataは再利用する", async () => {
		const h = catalogHarness();
		h.request.mockRejectedValueOnce(new Error("private HTTP body"));
		await h.account.refreshCatalog(h.signal);
		expect(h.account.snapshot().configOptions![0]!.options).toHaveLength(4);
		expect(h.account.snapshot().configOptions![0]!.options[0]?.name).toBe(
			"Static astra",
		);
		expect(h.account.snapshot().connection).toBe("ready");
		expect(
			h.account
				.snapshot()
				.configOptions![1]!.options.map((item) => item.value),
		).toEqual(h.session.model.levels);
		await h.account.refreshCatalog(h.signal);
		h.request.mockRejectedValueOnce(new Error("private HTTP body"));
		await h.account.refreshCatalog(h.signal);
		expect(h.account.snapshot().configOptions![0]!.options).toHaveLength(2);
		expect(h.account.snapshot().configOptions![0]!.options[0]?.name).toBe(
			"Live small",
		);
		expect(JSON.stringify(h.account.snapshot())).not.toMatch(
			/fixture-account|test-secret|private HTTP/,
		);
	});

	it("liveが非対応のoff・minimalを候補とHostの選択受付から除く", async () => {
		const h = catalogHarness();
		await h.account.refreshCatalog(h.signal);
		expect(h.session.thinkingLevel).toBe("minimal");
		expect(
			h.account.snapshot().configOptions![1]!.options.map((o) => o.value),
		).toEqual(["low", "high", "max", "ultra"]);
		for (const level of ["off", "minimal", "medium"]) {
			expect(() =>
				h.account.selectThinkingLevel(level, h.signal),
			).toThrow();
		}
		await h.account.selectThinkingLevel("high", h.signal);
		expect(() =>
			h.account.selectThinkingLevel("persistent", h.signal),
		).toThrow();
		await h.account.selectThinkingLevel("ultra", h.signal);
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
			effectiveReasoning: "max",
			reasoningOverride: null,
			fastMode: false,
		});
		expect(
			h.account
				.snapshot()
				.configOptions!.some((o) => o.id === "fast-mode"),
		).toBe(false);
	});

	it("liveが明示したnone・minimalは公開し、Piにない値は追加しない", async () => {
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
		).toBe("high");
	});

	it("liveにmaxがなければ対応するhighをUltra基底に使う", async () => {
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
		await h.account.selectThinkingLevel("ultra", h.signal);
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
