// 項目の説明・選択チェック・ホバーと context ツールチップを検証する。
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	test(`設定一覧とツールチップ: ${theme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 900 });
		await page.emulateMedia({
			colorScheme: theme,
			reducedMotion: "reduce",
		});
		await page.goto(
			"/iframe.html?id=chat-composer-settings--connected&viewMode=story",
		);
		const model = page.getByRole("combobox", {
			name: "Model",
			exact: true,
		});
		await model.click();
		const selected = page.getByRole("option", {
			name: "6 Astra",
			exact: true,
		});
		const other = page.getByRole("option", {
			name: "5.6 Luna",
			exact: true,
		});
		await expect(selected).toHaveAttribute("aria-selected", "true");
		await expect(selected.locator(".lucide-check")).toBeVisible();
		await expect(other.locator(".lucide-check")).toHaveCount(0);
		await expect(selected).toHaveCSS("font-size", "12px");
		await expect(page.locator(".config-popup")).toHaveCSS("width", "280px");
		await expect(page.locator(".config-popup style")).toHaveCount(0);
		await other.hover();
		await expect(page.getByRole("tooltip")).toHaveText(
			"Fast and affordable agentic coding model.",
		);
		await expect(other).toHaveAttribute("data-highlighted", "");
		await info.attach("model-menu-hover", {
			body: await page.screenshot({
				path: info.outputPath("model-menu.png"),
			}),
			contentType: "image/png",
		});
		await other.click();
		await expect(model).toHaveText("5.6 Luna");
		await expect(page.getByRole("listbox")).toHaveCount(0);
		await model.focus();
		await page.keyboard.press("ArrowDown");
		await expect(
			page
				.getByRole("option", { name: "5.6 Luna", exact: true })
				.locator(".lucide-check"),
		).toBeVisible();
		await page.keyboard.press("Home");
		await page.keyboard.press("Enter");
		await expect(model).toHaveText("6 Astra");
		await page.getByRole("button", { name: "使用量60%" }).click();
		const context = page.getByRole("progressbar");
		await context.hover();
		await expect(page.getByRole("tooltip")).toHaveText(
			"context600/1000 (60%)",
		);
		await expect(page.getByRole("tooltip").locator("hr")).toBeVisible();
		await info.attach("context-tooltip", {
			body: await page.screenshot({
				path: info.outputPath("context.png"),
			}),
			contentType: "image/png",
		});
		await page.keyboard.press("Escape");
		await expect(page.getByRole("tooltip")).toHaveCount(0);
		await page.getByRole("switch", { name: "Fast mode" }).hover();
		await expect(page.getByRole("tooltip")).toHaveText(
			"Default speed, normal usage",
		);
		await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 320);
		expect(errors).toEqual([]);
	});
}
