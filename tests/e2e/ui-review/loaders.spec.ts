// ローダーの途中フレームと動きの抑制設定、停止後の除去を確認する。
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	test(`CubeLoader の反転と停止: ${theme}`, async ({ page }, info) => {
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
		await page.goto("/iframe.html?id=chat-app--streaming&viewMode=story");
		await expect(
			page.getByRole("status", { name: "応答中" }),
		).toBeVisible();
		await expect(page.getByText("応答中", { exact: true })).toHaveCount(0);
		const cube = page.locator(".cube-loader-shape");
		for (const time of [0, 850, 1680, 2800]) {
			await cube.evaluate((element, time) => {
				const animation = element.getAnimations()[0]!;
				animation.pause();
				animation.currentTime = time;
			}, time);
			await info.attach(`cube-${time}`, {
				body: await page.screenshot({
					path: info.outputPath(`cube-${time}.png`),
				}),
				contentType: "image/png",
			});
		}
		await page.emulateMedia({ reducedMotion: "reduce" });
		await expect(cube).toHaveCSS("animation-name", "none");
		await page.getByRole("button", { name: "停止", exact: true }).click();
		await expect(cube).toHaveCount(0);
		expect(errors).toEqual([]);
	});
}
