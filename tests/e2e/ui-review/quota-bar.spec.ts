// status Contribution の時間枠別残率・詳細・非表示を明暗テーマで撮影する。
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	test(`利用枠のバー: ${theme}`, async ({ page }, info) => {
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
			reducedMotion: "no-preference",
		});
		await page.goto(
			"/iframe.html?id=chat-composer-settings--connected&viewMode=story",
		);
		const bar = page.getByRole("progressbar", {
			name: "利用枠の残量",
			exact: true,
		});
		await expect(bar).toHaveCount(0);
		await page
			.getByRole("button", { name: "利用枠取得", exact: true })
			.click();
		await expect(bar).toHaveAttribute("aria-valuenow", "60");
		await expect(bar).toHaveClass(/quota-bar/);
		await bar.hover();
		await expect(page.getByRole("tooltip")).toContainText(
			"codex 5h limit: 60%",
		);
		await expect(page.getByRole("tooltip")).toContainText(
			"codex Weekly limit: 85%",
		);
		await expect(page.getByRole("tooltip")).toContainText("resets 18:00");
		await info.attach("quota-status", {
			body: await page.screenshot({
				path: info.outputPath("quota-status.png"),
			}),
			contentType: "image/png",
		});
		await page.getByRole("button", { name: "利用枠取得失敗" }).click();
		await expect(bar).toHaveCount(0);
		await page
			.getByRole("button", { name: "利用枠取得", exact: true })
			.click();
		await expect(bar).toBeVisible();
		await page.getByRole("button", { name: "切断通知" }).click();
		await expect(bar).toHaveCount(0);
		await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 320);
		expect(errors).toEqual([]);
	});
}
