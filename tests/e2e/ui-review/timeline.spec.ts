// 会話とツールの順序・履歴・一枚のカード構造をブラウザで検証する。
import { test, expect } from "@playwright/test";

test("受信順のカードを次の送信後も保持する", async ({ page }, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	await page.setViewportSize({ width: 320, height: 900 });
	await page.goto("/iframe.html?id=chat-timeline--history&viewMode=story");
	const entries = page.locator(".message, .tool-card");
	await expect(entries).toHaveCount(4);
	await expect(entries.nth(1)).toContainText("テストを実行します。");
	await expect(entries.nth(2)).toHaveClass("tool-card");
	await expect(entries.nth(3)).toContainText("テストが成功しました。");
	await page
		.getByRole("button", { name: "pnpm.cmd test", exact: true })
		.click();
	await expect(page.locator(".tool-body")).toHaveText("✓ All tests passed");
	await expect(page.locator(".tool-cwd")).toHaveCSS("font-size", "10px");
	await expect(page.locator(".activity .tool-card")).toHaveCount(0);
	await page
		.getByRole("textbox", { name: "Codexへのメッセージ" })
		.fill("続けてください");
	await page.getByRole("button", { name: "送信", exact: true }).click();
	await expect(page.getByText(/作業が完了しました/)).toBeVisible();
	await expect(entries.nth(2)).toHaveClass("tool-card");
	await expect(entries.nth(4)).toContainText("続けてください");
	await expect(page.locator(".tool-body")).toBeVisible();
	await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 320);
	await page.screenshot({
		path: info.outputPath("history.png"),
		fullPage: true,
	});
	expect(errors).toEqual([]);
});
