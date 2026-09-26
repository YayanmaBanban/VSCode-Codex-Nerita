// 親モデルの推論候補を他モデルへ流用せず、モデル ID ごとの能力を公開する。
import { expect, it } from "vitest";
import { catalogHarness, liveModel } from "./piCatalogHarness";

it("filters each Pi model with its own catalog entry without changing the parent", async () => {
	const h = catalogHarness();
	h.payload.models.push(
		liveModel("spark", {
			supported_reasoning_levels: [{ effort: "medium" }],
		}),
	);
	await h.catalog.refresh("openai-codex", h.signal);
	const models = h.account.agentModels();
	expect(
		models.find((model) => model.value === "openai-codex/astra")?.efforts,
	).toEqual(["low", "high", "max", "ultra"]);
	expect(
		models.find((model) => model.value === "openai-codex/spark")?.efforts,
	).toEqual(["medium"]);
	expect(
		models.find((model) => model.value === "openai-codex/small")?.efforts,
	).toEqual(["low"]);
	expect(
		models.find((model) => model.value === "local/local")?.efforts,
	).toEqual(["off"]);
	expect(h.session.setModel).not.toHaveBeenCalled();
	expect(h.session.setThinkingLevel).not.toHaveBeenCalled();
});

it("retains Ultra for multiple models even when the SDK standard list lacks it", async () => {
	const h = catalogHarness();
	h.payload.models.push(liveModel("spark"));
	await h.catalog.refresh("openai-codex", h.signal);
	const models = h.account.agentModels();
	for (const id of ["astra", "spark"]) {
		expect(
			models.find((model) => model.value === `openai-codex/${id}`)
				?.efforts,
		).toContain("ultra");
	}
	expect(
		models.find((model) => model.value === "openai-codex/small")?.efforts,
	).not.toContain("ultra");
});
