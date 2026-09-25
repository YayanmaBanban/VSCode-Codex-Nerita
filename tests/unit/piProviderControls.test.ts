// 実効推論・要求変換・モデル切替と通信検証の境界を検証する。
import { describe, expect, it } from "vitest";
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { PiProviderControls } from "../../src/extension/backends/pi/PiProviderControls";
import { PiAccount } from "../../src/extension/backends/pi/PiAccount";
import { isPiProviderControls } from "../../src/shared/piProviderControls";
import { createBuiltinUiRegistry } from "../../src/extension/ui-contributions/builtinContributions";
import { initialState } from "../../src/shared/chatState";
import { piHarness } from "./piHarness";
import { piLiveCatalog } from "../fixtures/piLiveCatalog";

/** SDK のモデル変更時範囲内への補正を持つセッションを用意する。 */
function fixture() {
	const models = [
		{
			provider: "openai-codex",
			id: "max-model",
			api: "openai-codex-responses",
			name: "Codex",
			levels: ["low", "high", "max"],
		},
		{
			provider: "openai-codex",
			id: "small",
			api: "openai-codex-responses",
			name: "Small",
			levels: ["low", "high"],
		},
		{
			provider: "anthropic",
			id: "claude",
			api: "anthropic-messages",
			name: "Claude",
			levels: ["low", "high"],
		},
	];
	const session = {
		model: models[0]!,
		thinkingLevel: "high",
		getAvailableThinkingLevels: () => session.model.levels,
		setThinkingLevel: (level: string) => {
			session.thinkingLevel = level;
		},
		setModel: (model: (typeof models)[number]) => {
			session.model = model;
			if (!model.levels.includes(session.thinkingLevel)) {
				session.thinkingLevel = "high";
			}
			return Promise.resolve();
		},
	};
	const controls = new PiProviderControls();
	const account = new PiAccount(
		{
			getAvailableSnapshot: () => models,
			getAvailable: () => Promise.resolve(models),
			getProviderAuthStatus: () => ({ configured: true }),
			isUsingOAuth: () => false,
		} as unknown as ModelRuntime,
		session as unknown as AgentSession,
		undefined,
		controls,
	);
	account.catalog.snapshot = (provider) =>
		provider === "openai-codex" ? piLiveCatalog : undefined;
	account.catalog.refresh = () => Promise.resolve();
	return { session, controls, account, signal: new AbortController().signal };
}

describe("Pi provider controls", () => {
	it("Ultra対応モデル間はoverrideを維持し、SDK側の通常推論変更では解除する", () => {
		const h = fixture();
		h.controls.selectReasoning("ultra", h.signal);
		h.session.model = { ...h.session.model, id: "another-max-model" };
		h.session.thinkingLevel = "high";
		expect(h.controls.snapshot()).toMatchObject({
			thinkingLevel: "max",
			effectiveReasoning: "ultra",
		});
		h.session.setThinkingLevel("low");
		expect(h.controls.snapshot()).toMatchObject({
			thinkingLevel: "low",
			reasoningOverride: null,
		});
	});
	it("Ultraの標準基底をmaxに保ち、Fast Modeと独立して要求へ適用する", () => {
		const h = fixture();
		h.controls.selectReasoning("ultra", h.signal);
		h.controls.configure("fast-mode", "on", h.signal);
		expect(h.controls.snapshot()).toMatchObject({
			thinkingLevel: "max",
			effectiveReasoning: "ultra",
			reasoningOverride: "ultra",
			fastMode: true,
		});
		const original = {
			input: [],
			reasoning: { effort: "max", summary: "auto" },
			userExtension: true,
		};
		expect(
			h.controls.rewrite(
				original,
				h.session.model as unknown as AgentSession["model"],
			),
		).toEqual({
			...original,
			reasoning: { effort: "ultra", summary: "auto" },
			service_tier: "priority",
		});
		expect(original.reasoning.effort).toBe("max");
		h.controls.selectReasoning("low", h.signal);
		expect(h.controls.snapshot()).toMatchObject({
			effectiveReasoning: "low",
			reasoningOverride: null,
			fastMode: true,
		});
		h.controls.configure("fast-mode", "off", h.signal);
		expect(
			h.controls.rewrite(
				original,
				h.session.model as unknown as AgentSession["model"],
			),
		).toBeUndefined();
	});
	it("provider変更でclamp・固有設定解除・候補再生成を同時に公開する", async () => {
		const h = fixture();
		h.controls.selectReasoning("ultra", h.signal);
		h.controls.configure("fast-mode", "on", h.signal);
		await h.account.selectProvider("anthropic", h.signal);
		const snapshot = h.account.snapshot();
		expect(snapshot.piProviderControls).toMatchObject({
			provider: "anthropic",
			modelId: "claude",
			effectiveReasoning: "high",
			fastMode: false,
			reasoningOverride: null,
		});
		expect(
			snapshot.configOptions!.find((item) => item.id === "fast-mode"),
		).toBeUndefined();
		expect(
			snapshot.configOptions!.find((item) => item.id === "model")!
				.options,
		).toHaveLength(1);
		expect(() => h.controls.selectReasoning("ultra", h.signal)).toThrow();
		expect(() =>
			h.controls.configure("fast-mode", "on", h.signal),
		).toThrow();
		await h.account.selectProvider("openai-codex", h.signal);
		expect(h.controls.snapshot()).toMatchObject({
			fastMode: false,
			reasoningOverride: null,
		});
	});
	it("低い推論上限・不正値・取消・別モデルへの要求ではoverrideしない", async () => {
		const h = fixture();
		h.controls.selectReasoning("ultra", h.signal);
		expect(
			h.controls.rewrite({}, {
				provider: "anthropic",
				id: "claude",
			} as unknown as AgentSession["model"]),
		).toBeUndefined();
		await h.account.selectModel("openai-codex/small", h.signal);
		expect(
			h.controls.reasoningOptions.some((item) => item.value === "ultra"),
		).toBe(false);
		expect(h.controls.snapshot().effectiveReasoning).toBe("high");
		expect(() => h.controls.selectReasoning("ultra", h.signal)).toThrow();
		expect(() =>
			h.controls.configure("fast-mode", "priority", h.signal),
		).toThrow();
		expect(() =>
			h.controls.configure("fast-mode", "on", AbortSignal.abort()),
		).toThrow();
		await expect(
			h.account.selectProvider("missing", h.signal),
		).rejects.toThrow();
	});
	it("状態検証は不整合・秘密値の追加・未知レベルを拒否する", () => {
		const value = fixture().controls.snapshot();
		expect(isPiProviderControls(value)).toBe(true);
		for (const invalid of [
			{ ...value, token: "secret" },
			{ ...value, thinkingLevel: "ultra" },
			{ ...value, effectiveReasoning: "ultra" },
		]) {
			expect(isPiProviderControls(invalid)).toBe(false);
		}
	});
	it("Controllerのconfig/set経由で固有設定を公開し、実行中と旧会話を拒否する", async () => {
		const h = piHarness();
		const setup = fixture();
		h.runtime.account = setup.account;
		await h.controller.connect();
		const send = (configId: string, value: string, sessionId = "pi-1") =>
			h.controller.receive({
				type: "config/set",
				requestId: crypto.randomUUID(),
				sessionId,
				configId,
				value,
			});
		await send("reasoning_effort", "ultra");
		await send("fast-mode", "on");
		expect(h.controller.snapshot().piProviderControls).toMatchObject({
			effectiveReasoning: "ultra",
			fastMode: true,
		});
		await send("fast-mode", "off", "old");
		await h.send();
		await send("provider", "anthropic");
		expect(h.controller.snapshot().piProviderControls?.provider).toBe(
			"openai-codex",
		);
		expect(
			h.events.filter((event) => event.type === "request/failed"),
		).toHaveLength(2);
		await h.controller.dispose();
	});
	it("正規化済み利用枠をprovider名に依存せず登録し、切断時は公開しない", () => {
		const registry = createBuiltinUiRegistry();
		const state = {
			...initialState(),
			connection: "ready" as const,
			quota: [{ label: "5h", remaining: 68, detail: "reset" }],
		};
		for (const backend of ["pi", "codex"] as const) {
			const context = {
				backend,
				provider: "openai-codex",
				capabilities: [],
			};
			expect(
				registry
					.resolve(state, context)
					.items.filter((item) => item.slot === "status"),
			).toMatchObject([
				{ control: { type: "quota", windows: state.quota } },
			]);
			expect(
				registry
					.resolve(state, { ...context, provider: "google" })
					.items.some((item) => item.slot === "status"),
			).toBe(true);
			expect(
				registry
					.resolve({ ...state, connection: "disconnected" }, context)
					.items.some((item) => item.slot === "status"),
			).toBe(false);
		}
	});
});
