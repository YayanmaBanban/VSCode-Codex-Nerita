// 個人情報設定の外観を確認する。
// 実行: `pnpm test:scratch guardrails-privacy-review.spec.cjs --grep "@privacy-layout"`。
const { test, expect, waitForStory } = require("../support/scratch-test.cjs");

for (const [theme, width] of [
	["dark2026", 1200],
	["dark2026", 360],
	["light", 900],
	["light", 360],
]) {
	test(`個人情報設定 ${theme} ${width} @privacy-layout`, async ({
		reviewBrowser,
	}, testInfo) => {
		const page = await reviewBrowser.newPage({
			viewport: { width, height: 950 },
		});
		await page.goto(
			`http://localhost:6006/iframe.html?id=pi-guardrails--privacy-disabled&viewMode=story&globals=theme:${theme}`,
		);
		await waitForStory(page);
		const region = page.getByRole("region", { name: "個人情報の送信設定" });
		await expect(region).toBeVisible();
		const geometry = await page.evaluate(() => ({
			width: globalThis.innerWidth,
			scroll: globalThis.document.documentElement.scrollWidth,
			background: globalThis.getComputedStyle(
				globalThis.document.querySelector("main"),
			).backgroundColor,
			color: globalThis.getComputedStyle(
				globalThis.document.querySelector("main"),
			).color,
		}));
		expect(geometry.scroll).toBeLessThanOrEqual(width);
		await page.screenshot({ path: testInfo.outputPath("privacy.png") });
		await testInfo.attach("geometry", {
			body: JSON.stringify(geometry),
			contentType: "application/json",
		});
	});
}
