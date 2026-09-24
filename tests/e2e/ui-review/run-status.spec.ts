// 停止中・停止済み・失敗時の文言と猫アイコンを明暗テーマで確認する。
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	test(`実行状態の猫アイコン: ${theme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.emulateMedia({
			colorScheme: theme,
			reducedMotion: "no-preference",
		});
		for (const [story, label, icon, duration] of [
			["cancelling", "停止しています…", "cat-loaf-glasses-48", 2800],
			["cancelled", "停止しました", "cat-loaf-glasses-48", 2800],
			["failed", "実行に失敗しました", "cat-startled-fixed-48", 5600],
		] as const) {
			await page.goto(
				`/iframe.html?id=chat-app--${story}&viewMode=story`,
			);
			const status = page.locator(".run-status");
			await expect(status).toContainText(label);
			await expect(status.locator(`svg.${icon}`)).toBeVisible();
			for (const progress of [0, 0.2, 0.55, 0.9, 1]) {
				await status.evaluate((element, time) => {
					for (const animation of element.getAnimations({
						subtree: true,
					})) {
						animation.pause();
						animation.currentTime = time;
					}
				}, duration * progress);
				await info.attach(`${story}-${progress}`, {
					body: await status.screenshot({
						path: info.outputPath(`${story}-${progress}.png`),
					}),
					contentType: "image/png",
				});
			}
			await page.emulateMedia({ reducedMotion: "reduce" });
			await expect
				.poll(() =>
					status.evaluate(
						(el) => el.getAnimations({ subtree: true }).length,
					),
				)
				.toBe(0);
			await page.emulateMedia({ reducedMotion: "no-preference" });
		}
		expect(errors).toEqual([]);
	});
}
