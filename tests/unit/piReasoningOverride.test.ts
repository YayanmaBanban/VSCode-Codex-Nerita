// 実 Pi 履歴と要求変換を組み合わせ、推論更新の順序・分岐・圧縮境界を検証する。
import { describe, expect, it } from "vitest";
import {
	SessionManager,
	type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { CodexReasoningOverride } from "../../src/extension/backends/pi/codex/CodexReasoningOverride";
import { CodexProviderControls } from "../../src/extension/backends/pi/codex/CodexProviderControls";
import { normalizeCodexModels } from "../../src/extension/backends/pi/codex/CodexModelCatalog";
import { liveModel } from "./piCatalogHarness";

/** SDK が毎回構築する更新を含まない要求を再現する。 */
function payload(
	effort = "medium",
	input: unknown[] = [{ role: "user", content: "one" }],
) {
	return {
		model: "gpt-6-astra",
		reasoning: { effort, summary: "auto" },
		input,
		extensionField: true,
	};
}
/** 通信形式上の更新だけを取り出す。 */
function updates(value: ReturnType<typeof payload>) {
	return value.input.filter(
		(item) => (item as { type?: string }).type === "configuration_update",
	);
}
/** Pi の永続化形式を保ったまま再起動を模擬する。 */
function restore(store: SessionManager) {
	return SessionManager.inMemory(process.cwd(), undefined, [
		store.getHeader()!,
		...structuredClone(store.getBranch()),
	]);
}
/** 能力・通常推論・Ultra・Fast を同じセッションで操作する。 */
function fixture() {
	const store = SessionManager.inMemory();
	const session = {
		model: {
			provider: "openai-codex",
			id: "gpt-6-astra",
			api: "openai-codex-responses",
			baseUrl: "https://chatgpt.com/backend-api",
		},
		sessionManager: store,
		thinkingLevel: "medium",
		isCompacting: false,
		getAvailableThinkingLevels: () => ["low", "medium", "high", "max"],
		setThinkingLevel: (value: string) => {
			session.thinkingLevel = value;
		},
	};
	const controls = new CodexProviderControls();
	controls.bind(session as unknown as AgentSession);
	const catalog = normalizeCodexModels({
		models: [
			liveModel("gpt-6-astra", {
				supports_reasoning_effort_updates: true,
				supported_reasoning_levels: [
					"low",
					"medium",
					"high",
					"max",
					"ultra",
				].map((effort) => ({ effort })),
			}),
		],
	})!;
	controls.setCatalog(catalog);
	const rewrite = (value = payload()) =>
		controls.rewrite(value, session.model as AgentSession["model"]) as
			ReturnType<typeof payload> | undefined;
	return { store, session, controls, catalog, rewrite };
}

describe("Codex reasoning update history", () => {
	it("別modelKeyでは新しいeffortをbaselineとして固定する", () => {
		const store = SessionManager.inMemory();
		const planner = new CodexReasoningOverride();
		planner.rewrite(payload(), "first-model", store);
		planner.rewrite(payload("high"), "first-model", store);
		const second = planner.rewrite(
			payload("low"),
			"second-model",
			store,
		) as ReturnType<typeof payload>;
		expect(second.reasoning.effort).toBe("low");
		expect(updates(second)).toEqual([]);
		const next = planner.rewrite(
			payload("high"),
			"second-model",
			store,
		) as ReturnType<typeof payload>;
		expect(next.reasoning.effort).toBe("low");
		expect(updates(next)).toEqual([
			{ type: "configuration_update", reasoning: { effort: "high" } },
		]);
	});
	it("medium → high → lowを同じbaselineと元の位置で再送する", () => {
		const planner = new CodexReasoningOverride();
		const store = SessionManager.inMemory();
		const send = (value: ReturnType<typeof payload>) =>
			planner.rewrite(value, "model", store) as ReturnType<
				typeof payload
			>;
		const first = payload();
		expect(send(first)).toEqual(first);
		const high = payload("high", [
			...first.input,
			{ role: "assistant", content: "reply" },
			{ role: "user", content: "two" },
		]);
		const second = send(high);
		expect(second.reasoning.effort).toBe("medium");
		expect(updates(second)).toEqual([
			{ type: "configuration_update", reasoning: { effort: "high" } },
		]);
		expect(send(high)).toEqual(second);
		const duplicate = payload("high", second.input);
		expect(send(duplicate)).toEqual(second);
		const low = payload("low", [
			...high.input,
			{ role: "assistant", content: "reply2" },
			{ role: "user", content: "three" },
		]);
		const third = send(low);
		expect(third.reasoning).toEqual({ effort: "medium", summary: "auto" });
		expect(third.input[3]).toEqual(updates(second)[0]);
		expect(updates(third)).toEqual([
			...updates(second),
			{ type: "configuration_update", reasoning: { effort: "low" } },
		]);
		expect(high.input).toHaveLength(3);
		expect(first.reasoning.effort).toBe("medium");
		expect(third.extensionField).toBe(true);
		const restarted = new CodexReasoningOverride().rewrite(
			low,
			"model",
			restore(store),
		);
		expect(restarted).toEqual(third);
	});
	it("同じtailの変更は置換し、baselineへ戻せば更新を除く", () => {
		const h = fixture();
		h.rewrite();
		expect(updates(h.rewrite(payload("high"))!)).toHaveLength(1);
		expect(updates(h.rewrite(payload("low"))!)).toEqual([
			{ type: "configuration_update", reasoning: { effort: "low" } },
		]);
		expect(updates(h.rewrite(payload("medium"))!)).toEqual([]);
	});
	it("forkの現在分岐だけを復元し、別分岐のlowを持ち込まない", () => {
		const h = fixture();
		h.rewrite();
		const high = payload("high", [
			...payload().input,
			{ role: "user", content: "two" },
		]);
		const expected = h.rewrite(high);
		const leaf = h.store.getLeafId()!;
		h.rewrite(
			payload("low", [...high.input, { role: "user", content: "three" }]),
		);
		h.store.branch(leaf);
		expect(h.rewrite(high)).toEqual(expected);
	});
	it("圧縮失敗とfallback要求はpinを維持し、成功記録だけで再確立する", () => {
		const h = fixture();
		h.rewrite();
		h.rewrite(payload("high"));
		const before = structuredClone(h.store.getBranch());
		h.session.isCompacting = true;
		expect(h.rewrite(payload("low"))).toBeUndefined();
		expect(h.store.getBranch()).toEqual(before);
		h.session.isCompacting = false;
		expect(
			h.rewrite({ ...payload("low"), model: "fallback" }),
		).toBeUndefined();
		expect(h.rewrite(payload("high"))?.reasoning.effort).toBe("medium");
		const user = h.store.appendMessage({
			role: "user",
			content: "summary",
			timestamp: Date.now(),
		});
		h.store.appendCompaction("summary", user, 100);
		const after = h.rewrite(payload("low"))!;
		expect(after.reasoning.effort).toBe("low");
		expect(updates(after)).toEqual([]);
	});
	it("model変更・本文変更後は古いpinを再利用しない", () => {
		const h = fixture();
		h.rewrite();
		h.rewrite(payload("high"));
		h.store.appendModelChange("openai-codex", "other");
		h.store.appendModelChange("openai-codex", "gpt-6-astra");
		expect(h.rewrite(payload("low"))?.reasoning.effort).toBe("low");
		expect(
			h.rewrite(payload("high", [{ role: "user", content: "edited" }]))
				?.reasoning.effort,
		).toBe("high");
	});
	it.each([undefined, false, "true", 1])(
		"明示的なtrue以外はcapabilityを有効化しない: %s",
		(capability) => {
			const h = fixture();
			h.controls.setCatalog(
				normalizeCodexModels({
					models: [
						liveModel("gpt-6-astra", {
							supports_reasoning_effort_updates: capability,
						}),
					],
				}),
			);
			expect(h.rewrite()).toBeUndefined();
			expect(h.rewrite(payload("high"))).toBeUndefined();
			expect(h.store.getBranch()).toEqual([]);
		},
	);
	it.each(["gpt-6-sol", "gpt-6-luna", "gpt-6-astra-preview", "unknown"])(
		"live=trueでもbundledで未確認の%sは通常effortを維持する",
		(modelId) => {
			const h = fixture();
			h.session.model.id = modelId;
			h.catalog[0]!.slug = modelId;
			const low = { ...payload("low"), model: modelId };
			const high = { ...payload("high"), model: modelId };
			// 更新前の版で保存した baseline があっても、通常要求へ復帰させる。
			const old = new CodexReasoningOverride();
			const key = `openai-codex/${modelId}/${h.session.model.baseUrl}`;
			old.rewrite(low, key, h.store);
			old.rewrite(high, key, h.store);
			expect(h.rewrite(high)).toBeUndefined();
			expect(high.reasoning.effort).toBe("high");
			expect(updates(high)).toEqual([]);
			expect(h.store.getBranch().at(-1)).toMatchObject({ data: null });
			const entries = h.store.getBranch().length;
			expect(h.rewrite(low)).toBeUndefined();
			expect(h.store.getBranch()).toHaveLength(entries);
			h.controls.configure(
				"fast-mode",
				"on",
				new AbortController().signal,
			);
			expect(h.rewrite(high)).toMatchObject({
				reasoning: { effort: "high" },
				service_tier: "priority",
			});
		},
	);
	it("カスタムendpointと非Codex APIにはlive能力を転用しない", () => {
		const h = fixture();
		h.session.model.baseUrl = "https://custom.example/backend-api";
		expect(h.rewrite()).toBeUndefined();
		h.session.model.baseUrl = "https://chatgpt.com/backend-api";
		h.session.model.api = "openai-responses";
		expect(h.rewrite()).toBeUndefined();
	});
	it("Ultraへ切り替えた後は通常推論のbaselineを作り直しFastを保持する", () => {
		const h = fixture();
		const signal = new AbortController().signal;
		h.rewrite();
		h.rewrite(payload("high"));
		h.controls.configure("fast-mode", "on", signal);
		h.controls.selectReasoning("ultra", signal);
		const ultra = h.rewrite(payload("max"))!;
		expect(ultra).toMatchObject({
			reasoning: { effort: "ultra" },
			service_tier: "priority",
		});
		expect(updates(ultra)).toEqual([]);
		h.controls.selectReasoning("low", signal);
		expect(h.rewrite(payload("low"))).toMatchObject({
			reasoning: { effort: "low" },
			service_tier: "priority",
		});
	});
	it.each([
		null,
		{},
		{ input: [] },
		payload("unknown"),
		payload("ultra"),
		payload("high", [null]),
	])("不正payloadでは履歴も変更しない", (value) => {
		const store = SessionManager.inMemory();
		expect(
			new CodexReasoningOverride().rewrite(value, "model", store),
		).toBeUndefined();
		expect(store.getBranch()).toEqual([]);
	});
});
