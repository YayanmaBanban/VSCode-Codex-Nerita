// 子起動機構のない管理・ハンドオフ候補は SDK の通常推論だけを公開する。
import { expect, it } from "vitest";
import { catalogHarness, liveModel } from "./piCatalogHarness";

it("各モデル自身の SDK 候補を使い、live の Ultra・Fast 情報を推論へ追加しない", async () => {
	const h = catalogHarness();
	h.payload.models.push(
		liveModel("spark", {
			supported_reasoning_levels: [{ effort: "ultra" }],
			service_tiers: [{ id: "priority" }],
		}),
	);
	await h.catalog.refresh("openai", h.signal);
	const models = h.account.agentModels();
	expect(models.find((m) => m.value === "openai/astra")?.efforts).toEqual(
		h.all[0]!.levels,
	);
	expect(models.find((m) => m.value === "openai/small")?.efforts).toEqual([
		"low",
	]);
	expect(models.find((m) => m.value === "local/local")?.efforts).toEqual([
		"off",
	]);
	for (const model of models) {
		expect(model.efforts).not.toContain("ultra");
	}
	expect(h.session.setModel).not.toHaveBeenCalled();
	expect(h.session.setThinkingLevel).not.toHaveBeenCalled();
});
