// スラッシュ候補から MCP 一覧を表示し、狭い画面と明暗テーマの表示を確認する。
import { test, expect } from "@playwright/test";

for (const variant of ["dark", "light", "reduced"] as const) {
	test(`MCPコマンドの選択と結果表示: ${variant}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 820 });
		await page.emulateMedia({
			colorScheme: variant === "light" ? "light" : "dark",
			reducedMotion: variant === "reduced" ? "reduce" : "no-preference",
		});
		await page.clock.install();
		await page.goto("/iframe.html?id=chat-app--empty&viewMode=story");
		const input = page.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		await input.fill("/m");
		await expect(page.getByRole("option", { name: /mcp/ })).toBeVisible();
		await page.screenshot({ path: info.outputPath("mcp-menu.png") });
		await input.press("Enter");
		await expect(input).toHaveText("/mcp");
		await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
		await input.press("Control+Enter");
		const result = page.locator(".message.assistant");
		const loading = result.getByRole("status", { name: "取得中…" });
		await expect(loading).toBeVisible();
		await expect(loading.locator(".cat-loaf-glasses-48")).toBeVisible();
		await expect(
			result.getByRole("button", { name: "回答をコピー" }),
		).toHaveCount(0);
		await page.screenshot({
			path: info.outputPath("mcp-loading-initial.png"),
		});
		const shiny = loading.locator(".inline-block");
		const initial = await shiny.evaluate(
			(element) => getComputedStyle(element).backgroundPosition,
		);
		await page.clock.runFor(500);
		const middle = await shiny.evaluate(
			(element) => getComputedStyle(element).backgroundPosition,
		);
		if (variant === "reduced") {
			expect(middle).toBe(initial);
			await expect(loading.locator(".clg48-tail")).toHaveCSS(
				"animation-name",
				"none",
			);
		} else {
			expect(middle).not.toBe(initial);
		}
		await page.screenshot({
			path: info.outputPath("mcp-loading-500ms.png"),
		});
		await page.clock.runFor(1100);
		await expect(loading).toHaveCount(0);
		const list = result.getByRole("list", { name: "MCPサーバー" });
		await expect(result).toContainText("設定済みMCPサーバー:");
		await expect(list.getByRole("listitem")).toHaveCount(3);
		await expect(list).toContainText("workspace");
		await expect(list).toContainText("mcptool_1");
		await expect(
			list.getByRole("img", { name: "connected", exact: true }),
		).toHaveClass(/bg-menu-check/);
		await expect(
			list.getByRole("img", { name: "disabled", exact: true }),
		).toHaveClass(/bg-tool-error/);
		await expect(list.getByRole("img", { name: "不明" })).toHaveClass(
			/bg-muted/,
		);
		await expect(result.locator("pre")).toHaveCount(0);
		await expect(
			result.getByRole("button", { name: "回答をコピー" }),
		).toBeVisible();
		await expect(input).toBeEmpty();
		await result.scrollIntoViewIfNeeded();
		await page.screenshot({
			path: info.outputPath("mcp-result.png"),
			fullPage: true,
		});
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		expect(errors).toEqual([]);
	});
}
