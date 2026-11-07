// 別 Host の表示情報を確認する。
// 実行: `pnpm test:scratch host-presentation-review.spec.cjs --grep "@host-presentation"`。
const { test, expect, waitForStory } = require("../support/scratch-test.cjs");

for (const [story, theme, width] of [
	["pi-guardrails--privacy-settings", "dark2026", 360],
	["pi-credentials--default", "light", 1200],
	["chat-piautheditor--accounts", "dark2026", 1200],
	["trust-manager--help", "light", 900],
	["agent-manager--auto-review-help", "dark2026", 1200],
	["chat-app--authentication", "light", 360],
]) {
	test(`${story} ${theme} ${width} @host-presentation`, async ({
		reviewBrowser,
	}, testInfo) => {
		const page = await reviewBrowser.newPage({
			viewport: { width, height: 950 },
		});
		await page.goto(
			`http://localhost:6006/iframe.html?id=${story}&viewMode=story&globals=theme:${theme}`,
		);
		await waitForStory(page);
		await expect(page.locator("main")).toBeVisible();
		const scroll = await page.evaluate(
			() => globalThis.document.documentElement.scrollWidth,
		);
		expect(scroll).toBeLessThanOrEqual(width);
		await page.screenshot({
			path: testInfo.outputPath("host-presentation.png"),
			animations: "disabled",
		});
	});
}
