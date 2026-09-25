// 保存した推論設定をカタログの候補と照合し、起動時に一度だけ復元することを確認する。
import { describe, expect, it, vi } from "vitest";
import { PiAccount } from "../../src/extension/backends/pi/PiAccount";
import { catalogHarness } from "./piCatalogHarness";

describe("Piの推論復元", () => {
	it.each(["high", "ultra"])(
		"%sを復元し、その後の変更を保存する",
		async (reasoning) => {
			const h = catalogHarness();
			const save = vi.fn(() => Promise.resolve());
			const account = new PiAccount(
				h.sdkModels,
				h.sdkSession,
				undefined,
				undefined,
				h.catalog,
				save,
				{ provider: "openai-codex", model: "astra", reasoning },
			);
			await account.refreshCatalog(h.signal);
			expect(account.controls.snapshot().effectiveReasoning).toBe(
				reasoning,
			);
			await account.configure("reasoning_effort", "low", h.signal);
			expect(save).toHaveBeenLastCalledWith({
				provider: "openai-codex",
				model: "astra",
				reasoning: "low",
			});
			await account.refreshCatalog(h.signal);
			expect(account.controls.snapshot().effectiveReasoning).toBe("low");
		},
	);
	it.each(["off", "unknown"])(
		"対応しない保存値%sから利用可能な推論へ戻す",
		async (reasoning) => {
			const h = catalogHarness();
			const account = new PiAccount(
				h.sdkModels,
				h.sdkSession,
				undefined,
				undefined,
				h.catalog,
				undefined,
				{ provider: "openai-codex", model: "astra", reasoning },
			);
			await account.refreshCatalog(h.signal);
			expect(account.controls.snapshot().effectiveReasoning).toBe("low");
			expect(account.snapshot().connection).toBe("ready");
		},
	);
	it("削除されたモデルから復帰し、旧モデルのultraを適用しない", async () => {
		const h = catalogHarness();
		h.session.model = h.all[1]!;
		const account = new PiAccount(
			h.sdkModels,
			h.sdkSession,
			undefined,
			undefined,
			h.catalog,
			undefined,
			{ provider: "openai-codex", model: "spark", reasoning: "ultra" },
		);
		await account.refreshCatalog(h.signal);
		expect(h.session.model.id).toBe("small");
		expect(account.controls.snapshot().effectiveReasoning).toBe("low");
		expect(account.snapshot().connection).toBe("ready");
	});
});
