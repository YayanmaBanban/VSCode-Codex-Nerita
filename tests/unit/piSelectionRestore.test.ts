// 新プロバイダーの SDK 推論を復元し、旧選択の Ultra は流用しない。
import { describe, expect, it, vi } from "vitest";
import { PiAccount } from "../../apps/vscode-nerita/src/extension/backends/pi/PiAccount";
import { catalogHarness } from "./piCatalogHarness";

describe("Pi 推論の復元", () => {
	it("SDK の保存候補を復元して以後の変更を保存する", async () => {
		const h = catalogHarness(),
			save = vi.fn(() => Promise.resolve());
		const account = new PiAccount(
			h.sdkModels,
			h.sdkSession,
			undefined,
			undefined,
			h.catalog,
			save,
			{ provider: "openai", model: "astra", reasoning: "high" },
		);
		await account.refreshCatalog(h.signal);
		expect(account.controls.snapshot().effectiveReasoning).toBe("high");
		await account.configure("reasoning_effort", "low", h.signal);
		expect(save).toHaveBeenLastCalledWith({
			provider: "openai",
			model: "astra",
			reasoning: "low",
		});
		await account.refreshCatalog(h.signal);
		expect(account.controls.snapshot().effectiveReasoning).toBe("low");
	});
	it.each(["ultra", "unknown"])(
		"子起動なしの保存値 %s は SDK の通常値へ戻す",
		async (reasoning) => {
			const h = catalogHarness();
			const account = new PiAccount(
				h.sdkModels,
				h.sdkSession,
				undefined,
				undefined,
				h.catalog,
				undefined,
				{ provider: "openai", model: "astra", reasoning },
			);
			await account.refreshCatalog(h.signal);
			expect(account.controls.snapshot().effectiveReasoning).toBe(
				"minimal",
			);
		},
	);
	it("旧プロバイダーの同名モデルと Ultra を新選択として解釈しない", async () => {
		const h = catalogHarness();
		const account = new PiAccount(
			h.sdkModels,
			h.sdkSession,
			undefined,
			undefined,
			h.catalog,
			undefined,
			{ provider: "openai-codex", model: "astra", reasoning: "ultra" },
		);
		await account.refreshCatalog(h.signal);
		expect(account.controls.snapshot()).toMatchObject({
			provider: "openai",
			effectiveReasoning: "minimal",
			reasoningOverride: null,
		});
	});
});
