// ユーザー限定の参照チップが明暗・狭幅・Markdown内で表示されることを確認する。
import { test, expect } from "@playwright/test";

for (const colorScheme of ["dark", "light"] as const) {
	test(`送信済み参照チップ: ${colorScheme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 820 });
		await page.emulateMedia({ colorScheme });
		await page.goto(
			"/iframe.html?id=chat-messages--references&viewMode=story",
		);
		const user = page.locator(".message.user");
		await expect(user.locator(".message-reference")).toHaveCount(2);
		await expect(user.locator("strong")).toHaveText("確認対象");
		await expect(user.locator("code .message-reference")).toHaveCount(1);
		await expect(
			page.locator(".message.assistant .message-reference"),
		).toHaveCount(0);
		await expect(page.locator(".message.assistant")).toContainText(
			"D:/workspace/long.tsx",
		);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		await user.locator(".message-reference").first().focus();
		await page.screenshot({
			path: info.outputPath(`references-${colorScheme}.png`),
			fullPage: true,
		});
		expect(errors).toEqual([]);
	});
}
