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
			"/iframe.html?id=chat-pi-provider-controls--connected&viewMode=story",
		);
		const provider = page.getByRole("combobox", {
			name: "Provider",
			exact: true,
		});
		const reasoning = page.getByRole("combobox", {
			name: "Reasoning effort",
		});
		const fast = page.getByRole("switch", { name: "Fast mode" });
		const request = page.getByLabel("送信した要求");
		await reasoning.click();
		await page.getByRole("option", { name: "Ultra", exact: true }).click();
		await expect(request).toContainText('"configId":"reasoning_effort"');
		await expect(request).toContainText('"value":"ultra"');
		await fast.focus();
		await page.keyboard.press("Space");
		await expect(request).toContainText('"configId":"fast-mode"');
		await expect(request).toContainText('"value":"on"');
		await expect(fast).toBeChecked();
		await expect(reasoning).toHaveText("Ultra");
		await page.getByRole("progressbar", { name: "利用枠の残量" }).hover();
		await expect(page.getByRole("tooltip")).toContainText("5h: 68%");
		await expect(page.getByRole("tooltip")).toContainText("Weekly: 82%");
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
		await expect(fast).not.toBeChecked();
		await page.getByRole("button", { name: "実行状態を切替" }).click();
		await expect(provider).toBeDisabled();
		await expect(fast).toBeDisabled();
		await page.getByRole("button", { name: "実行状態を切替" }).click();
		await expect(provider).toBeEnabled();
		await page.getByRole("button", { name: "切断", exact: true }).click();
		await expect(provider).toBeDisabled();
		await page.goto(
			"/iframe.html?id=chat-pi-provider-controls--no-metadata&viewMode=story",
		);
		await expect(
			page.getByRole("combobox", { name: "Pi Model" }),
		).toHaveText("Codex Max Model");
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
