// ローダーの途中フレームと動きの抑制設定、停止後の除去を確認する。
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	test(`思考中の筆記表示と停止: ${theme}`, async ({ page }, info) => {
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
			page.getByRole("status", { name: "思考中...", exact: true }),
		).toBeVisible();
		const text = page.getByText("思考中...", { exact: true });
		await expect(text).toBeVisible();
		const cat = page.locator(".run-status-icon");
		await expect(cat.locator("svg.cat-writing-glasses-48")).toBeVisible();
		const initialShine = await text.evaluate(
			(el) => el.style.backgroundPosition,
		);
		await expect
			.poll(() => text.evaluate((el) => el.style.backgroundPosition))
			.not.toBe(initialShine);
		// SVGの時計を固定する。ShinyTextは上の変化確認と静止画で別に確認する。
		for (const time of [0, 400, 1800, 3300, 3600]) {
			await cat.evaluate((element, time) => {
				for (const animation of element.getAnimations({
					subtree: true,
				})) {
					animation.pause();
					animation.currentTime = time;
				}
			}, time);
			await info.attach(`thinking-${time}`, {
				body: await page.screenshot({
					path: info.outputPath(`thinking-${time}.png`),
				}),
				contentType: "image/png",
			});
		}
		await page.emulateMedia({ reducedMotion: "reduce" });
		await expect(cat.locator(".cwg48-head")).toHaveCSS(
			"animation-name",
			"none",
		);
		await page.reload();
		await expect(text).toBeVisible();
		const stoppedShine = await text.evaluate(
			(el) => getComputedStyle(el).backgroundPosition,
		);
		await page.evaluate(
			() =>
				new Promise<void>((resolve) =>
					requestAnimationFrame(() =>
						requestAnimationFrame(() => resolve()),
					),
				),
		);
		await expect(text).toHaveCSS("background-position", stoppedShine);
		await page.getByRole("button", { name: "停止", exact: true }).click();
		await expect(cat.locator("svg.cat-writing-glasses-48")).toHaveCount(0);
		await expect(cat.locator("svg.cat-loaf-glasses-48")).toBeVisible();
		await expect(text).toHaveCount(0);
		expect(errors).toEqual([]);
	});
}
