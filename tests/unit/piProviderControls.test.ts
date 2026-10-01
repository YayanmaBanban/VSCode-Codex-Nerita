// Ultra の Host 委譲・通常推論・権限失効と、通信の拒否境界を検証する。
import { describe, expect, it } from "vitest";
import { PiProviderControls } from "../../apps/vscode-nerita/src/extension/backends/pi/PiProviderControls";
import { isPiProviderControls } from "@nerita/shared/piProviderControls";
import { catalogHarness, liveModel } from "./piCatalogHarness";
import { piHarness } from "./piHarness";

/** 子起動が利用できる Host を模擬し、実行途中の失効も再現する。 */
async function fixture() {
	const h = catalogHarness();
	h.payload.models[1] = liveModel("astra", {
		supported_reasoning_levels: [
			"low",
			"high",
			"xhigh",
			"max",
			"ultra",
		].map((effort) => ({ effort })),
		multi_agent_reasoning_effort: "xhigh",
	});
	let enabled = true;
	h.account.controls.bindDelegation(() => enabled);
	await h.account.refreshCatalog(h.signal);
	return {
		...h,
		controls: h.account.controls,
		disable: () => {
			enabled = false;
		},
	};
}
describe("OpenAI provider controls", () => {
	it("Fast は対応モデルへ priority を送り、能力の失効で解除する", async () => {
		const h = await fixture();
		h.payload.models[1] = liveModel("astra", {
			service_tiers: [{ id: "priority" }],
		});
		await h.account.refreshCatalog(h.signal);
		h.controls.configure("fast-mode", "on", h.signal);
		const payload = { model: "astra", input: [] };
		expect(h.controls.rewrite(payload, h.sdkSession.model)).toEqual({
			...payload,
			service_tier: "priority",
		});
		expect(payload).not.toHaveProperty("service_tier");
		expect(
			h.controls.rewrite({ model: "another" }, h.sdkSession.model),
		).toBeUndefined();
		expect(
			h.controls.rewrite(payload, {
				...h.sdkSession.model!,
				baseUrl: "https://example.invalid/v1",
			}),
		).toBeUndefined();
		h.catalog.invalidate();
		expect(h.controls.snapshot().fastMode).toBe(false);
		expect(h.controls.configOptions).toEqual([]);
		expect(h.controls.rewrite(payload, h.sdkSession.model)).toBeUndefined();
	});
	it("Ultra の対応と実推論値はライブカタログから取得し、通常推論は SDK に従う", async () => {
		const h = await fixture();
		expect(h.controls.reasoningOptions.map((o) => o.value)).toEqual([
			...h.all[0]!.levels,
			"ultra",
		]);
		h.controls.selectReasoning("ultra", h.signal);
		expect(h.controls.snapshot()).toMatchObject({
			thinkingLevel: "xhigh",
			effectiveReasoning: "ultra",
			fastMode: false,
		});
		expect(h.controls.delegationPrompt()).toContain("subagent");
		expect(
			h.controls.rewrite(
				{ reasoning: { effort: "max" } },
				h.sdkSession.model,
			),
		).toBeUndefined();
		expect(h.controls.configOptions).toEqual([]);
		expect(() =>
			h.controls.configure("fast-mode", "on", h.signal),
		).toThrow();
		h.controls.selectReasoning("low", h.signal);
		expect(h.controls.delegationPrompt()).toBeUndefined();
	});
	it.each(["tool", "model", "provider", "effort", "endpoint"] as const)(
		"変化 %s で Ultra を解除する",
		async (change) => {
			const h = await fixture();
			h.controls.selectReasoning("ultra", h.signal);
			if (change === "tool") {
				h.disable();
			}
			if (change === "model") {
				h.session.model = { ...h.session.model, id: "another" };
			}
			if (change === "provider") {
				h.session.model = { ...h.session.model, provider: "local" };
			}
			if (change === "effort") {
				h.session.setThinkingLevel("high");
			}
			if (change === "endpoint") {
				h.session.model = {
					...h.session.model,
					baseUrl: "https://example.invalid/v1",
				};
			}
			expect(h.controls.snapshot().reasoningOverride).toBeNull();
			expect(h.controls.delegationPrompt()).toBeUndefined();
		},
	);
	it("未対応モデル・子起動無効・取消・未知値では Ultra を有効化しない", async () => {
		const h = await fixture();
		h.disable();
		expect(() => h.controls.selectReasoning("ultra", h.signal)).toThrow();
		const next = await fixture();
		next.session.model = next.all[3]!;
		expect(() =>
			next.controls.selectReasoning("ultra", next.signal),
		).toThrow();
		expect(() =>
			next.controls.selectReasoning("low", AbortSignal.abort()),
		).toThrow();
		expect(() =>
			next.controls.selectReasoning("persistent", next.signal),
		).toThrow();
	});
	it("max に対応してもカタログ未取得・Ultra なしでは公開せず、認証変更で解除する", async () => {
		const h = await fixture();
		h.controls.selectReasoning("ultra", h.signal);
		h.catalog.invalidate();
		expect(h.controls.snapshot().reasoningOverride).toBeNull();
		expect(
			h.controls.reasoningOptions.map((option) => option.value),
		).toEqual(h.all[0]!.levels);
		expect(() => h.controls.selectReasoning("ultra", h.signal)).toThrow();
		h.payload.models[1] = liveModel("astra", {
			supported_reasoning_levels: [{ effort: "max" }],
		});
		await h.account.refreshCatalog(h.signal);
		expect(
			h.controls.reasoningOptions.map((option) => option.value),
		).toEqual(h.all[0]!.levels);
	});
	it("カタログの effort が変わると解除し、新しい実推論値で再選択する", async () => {
		const h = await fixture();
		h.controls.selectReasoning("ultra", h.signal);
		h.payload.models[1] = liveModel("astra", {
			...h.payload.models[1],
			multi_agent_reasoning_effort: "high",
		});
		await h.account.refreshCatalog(h.signal);
		expect(h.controls.snapshot().reasoningOverride).toBeNull();
		h.controls.selectReasoning("ultra", h.signal);
		expect(h.session.thinkingLevel).toBe("high");
		h.session.model = {
			...h.session.model,
			thinkingLevelMap: {
				...h.session.model.thinkingLevelMap,
				high: "unsupported",
			},
		};
		expect(h.controls.snapshot().reasoningOverride).toBeNull();
		expect(() => h.controls.selectReasoning("ultra", h.signal)).toThrow();
	});
	it("状態検証は実効値の不整合と秘密値を拒否する", () => {
		const value = new PiProviderControls().snapshot();
		expect(isPiProviderControls(value)).toBe(true);
		for (const bad of [
			{ ...value, token: "secret" },
			{ ...value, thinkingLevel: "ultra" },
			{ ...value, effectiveReasoning: "ultra" },
		]) {
			expect(isPiProviderControls(bad)).toBe(false);
		}
	});
	it("Controller から変更でき、旧会話や実行中の変更は拒否する", async () => {
		const f = await fixture(),
			h = piHarness();
		h.runtime.account = f.account;
		await h.controller.connect();
		const send = (value: string, sessionId = "pi-1") =>
			h.controller.receive({
				type: "config/set",
				requestId: crypto.randomUUID(),
				sessionId,
				configId: "reasoning_effort",
				value,
			});
		await send("ultra");
		expect(
			h.controller.snapshot().piProviderControls?.effectiveReasoning,
		).toBe("ultra");
		await send("low", "old");
		await h.send();
		await send("high");
		expect(f.controls.snapshot().effectiveReasoning).toBe("ultra");
		expect(
			h.events.filter((e) => e.type === "request/failed"),
		).toHaveLength(2);
		await h.controller.dispose();
	});
});
