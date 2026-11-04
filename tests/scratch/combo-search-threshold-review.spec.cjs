// 実行: pnpm test:scratch combo-search-threshold-review.spec.cjs --grep "ケース名"
// 検索欄の表示境界を明暗テーマと狭い画面で撮影する。
const fs = require("node:fs/promises");
const { test } = require("../support/scratch-test.cjs");
const { expect } = require("@playwright/test");

/** 4件と5件で検索欄と初期フォーカスを確認し、比較用画像を残す。 */
async function runCase(browser, testInfo, { theme, count }) {
	const phase = process.env.SCRATCH_PHASE ?? "after";
	const root = testInfo.outputPath("review");
	await fs.mkdir(root, { recursive: true });

	const errors = [];
	{
		const page = await browser.newPage();
		page.on("pageerror", (error) => errors.push(String(error)));
		{
			await page.setViewportSize({ width: 360, height: 600 });
			await page.goto(
				`http://localhost:6006/iframe.html?id=ui-searchablecombolist--editor&viewMode=story&args=count:${count}&globals=theme:${theme}`,
			);
			await page.getByRole("combobox").click();
			const panel = page.getByRole("dialog");
			await expect(panel.getByRole("option")).toHaveCount(count);
			if (phase === "before" || count >= 5) {
				await expect(panel.getByRole("searchbox")).toBeFocused();
			} else {
				await expect(panel.getByRole("searchbox")).toHaveCount(0);
				await expect(panel.getByRole("option").first()).toBeFocused();
			}
			await page.screenshot({
				path: `${root}/${theme}-${count}.png`,
			});
		}
		await expect(errors).toEqual([]);
		console.log(root);
	}
}

for (const [theme, count] of [
	["dark2026", 4],
	["dark2026", 5],
	["light", 4],
	["light", 5],
]) {
	test(`combo-search-threshold-review ${theme} ${count} @layout`, async ({
		reviewBrowser: browser,
	}, testInfo) => {
		await runCase(browser, testInfo, { theme, count });
	});
}
