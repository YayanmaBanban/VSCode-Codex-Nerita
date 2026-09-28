// 設定の描画・キーボード操作・Host への要求・受信状態の反映を検証する。
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	test(`Pi provider controls: ${theme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 650 });
		await page.emulateMedia({
			colorScheme: theme,
			reducedMotion: "reduce",
		});
		await page.goto(
			`/iframe.html?id=chat-pi-provider-controls--connected&viewMode=story&globals=theme:${theme === "light" ? "light" : "dark2026"}`,
		);
		const provider = page.getByRole("combobox", {
			name: "Provider",
			exact: true,
		});
		const trigger = page.getByRole("button", {
			name: "モデルと推論レベル",
		});
		await trigger.click();
		await expect(
			page.getByRole("combobox", { name: "Pi Model" }),
		).toHaveText("GPT-6-Astra");
		const reasoning = page.getByRole("slider", {
			name: "Reasoning effort",
		});
		const fast = page.getByRole("switch", { name: "ファストモード" });
		const request = page.getByLabel("送信した要求");
		await reasoning.focus();
		await reasoning.press("End");
		await expect(request).toContainText('"configId":"reasoning_effort"');
		await expect(request).toContainText('"value":"ultra"');
		await fast.focus();
		await page.keyboard.press("Space");
		await expect(request).toContainText('"configId":"fast-mode"');
		await expect(request).toContainText('"value":"on"');
		await expect(fast).toBeChecked();
		await expect(reasoning).toHaveAttribute("aria-valuetext", "Ultra");
		await info.attach("model-card", {
			body: await page.screenshot({
				path: info.outputPath("model-card.png"),
			}),
			contentType: "image/png",
		});
		await reasoning.press("Escape");
		await expect(trigger.locator(".lucide-zap")).toBeVisible();
		await trigger.hover();
		await expect(page.getByRole("tooltip")).toContainText(
			"複雑な作業を必要に応じて、複数のエージェントへ委譲します。",
		);
		await page.getByRole("progressbar", { name: "利用枠の残量" }).hover();
		await expect(
			page.getByRole("tooltip", { name: /利用枠の残量/ }),
		).toContainText("5h: 68%");
		await expect(
			page.getByRole("tooltip", { name: /利用枠の残量/ }),
		).toContainText("Weekly: 82%");
		await info.attach("ultra-fast-quota", {
			body: await page.screenshot({ fullPage: true }),
			contentType: "image/png",
		});
		await provider.click();
		await page
			.getByRole("option", { name: "anthropic", exact: true })
			.click();
		await expect(request).toContainText('"configId":"provider"');
		await expect(request).toContainText('"value":"anthropic"');
		await expect(
			page.getByRole("combobox", { name: "Pi Model" }),
		).toHaveText("Claude");
		await expect(fast).toHaveCount(0);
		await expect(
			page.getByRole("progressbar", { name: "利用枠の残量" }),
		).toHaveCount(0);
		await provider.click();
		await page
			.getByRole("option", { name: "openai-codex", exact: true })
			.click();
		await trigger.click();
		await expect(fast).not.toBeChecked();
		await reasoning.press("Escape");
		await page.getByRole("button", { name: "実行状態を切替" }).focus();
		await page.getByRole("button", { name: "実行状態を切替" }).click();
		await expect(provider).toBeDisabled();
		await expect(trigger).toBeDisabled();
		await page.getByRole("button", { name: "実行状態を切替" }).click();
		await expect(provider).toBeEnabled();
		await page.getByRole("button", { name: "切断", exact: true }).click();
		await expect(provider).toBeDisabled();
		await page.goto(
			`/iframe.html?id=chat-pi-provider-controls--no-metadata&viewMode=story&globals=theme:${theme === "light" ? "light" : "dark2026"}`,
		);
		await expect(trigger).toHaveText("Codex Max Model high");
		await trigger.click();
		await expect(fast).toHaveCount(0);
		expect(
			await page
				.locator("body")
				.evaluate((element) => element.scrollWidth),
		).toBe(320);
		await info.attach("no-metadata", {
			body: await page.screenshot({ fullPage: true }),
			contentType: "image/png",
		});
		expect(errors).toEqual([]);
	});
}
