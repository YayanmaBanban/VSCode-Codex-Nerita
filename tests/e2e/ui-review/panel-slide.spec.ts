// 開閉中の高さとスライド位置、折りたたみ後の下書き保持を確認する。
import { test, expect } from "@playwright/test";

test("性格設定の開閉を時刻指定で撮影し、下書きを保持する", async ({
	page,
}, info) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.goto(
		"/iframe.html?id=chat-personality--editable&viewMode=story",
	);
	await page.getByRole("button", { name: "オプション", exact: true }).click();
	await page.getByRole("menuitem", { name: "性格設定" }).click();
	const panel = page.locator("#personality-global");
	const input = panel.getByRole("textbox", {
		name: "グローバルのプリセット名",
	});
	await input.fill("未保存の下書き");
	const toggle = page.getByRole("button", {
		name: "グローバル",
		exact: true,
	});
	for (const direction of ["close", "open"]) {
		await toggle.click();
		// CSS Transition を停止し、実時間の撮影遅延に依存せず各時刻を再現する。
		await panel.evaluate((element) => {
			for (const animation of element.getAnimations()) {animation.pause();}
		});
		const heights: number[] = [];
		for (const [label, time] of [
			["initial", 0],
			["early", 30],
			["middle", 110],
			["late", 190],
			["completed", 220],
		] as const) {
			await panel.evaluate((element, time) => {
				for (const animation of element.getAnimations())
					{animation.currentTime = time;}
			}, time);
			heights.push(
				await panel.evaluate(
					(element) => element.getBoundingClientRect().height,
				),
			);
			await info.attach(`${direction}-${label}-${time}ms`, {
				body: await page.screenshot({
					path: info.outputPath(`${direction}-${label}.png`),
					animations: "allow",
				}),
				contentType: "image/png",
			});
		}
		expect(heights[2]).toBeGreaterThan(Math.min(heights[0]!, heights[4]!));
		expect(heights[2]).toBeLessThan(Math.max(heights[0]!, heights[4]!));
		await panel.evaluate((element) => {
			for (const animation of element.getAnimations()) {animation.finish();}
		});
	}
	await expect(input).toHaveValue("未保存の下書き");
});

for (const width of [320, 1000]) {
	test(`セッション一覧のスライド開閉: ${width}`, async ({ page }, info) => {
		await page.setViewportSize({ width, height: 820 });
		await page.emulateMedia({ reducedMotion: "no-preference" });
		await page.goto(
			"/iframe.html?id=chat-sessions--history&viewMode=story",
		);
		const toggle = page.getByRole("button", {
			name: "セッション一覧",
			exact: true,
		});
		await toggle.click();
		const panel = page.locator("#session-panel");
		await expect(panel).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
		await page.screenshot({ path: info.outputPath("opened.png") });
		await panel
			.getByRole("button", { name: "セッション一覧を閉じる" })
			.click();
		await expect(panel).toHaveCount(0);
		await expect(toggle).toBeFocused();
		await page.screenshot({ path: info.outputPath("closed.png") });
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
	});
}
