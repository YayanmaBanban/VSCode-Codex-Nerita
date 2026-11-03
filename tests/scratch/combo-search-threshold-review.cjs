// 実行: node tests/scratch/combo-search-threshold-review.cjs before|after
// 検索欄の表示境界を明暗テーマと狭い画面で撮影する。
const fs = require("node:fs/promises");
const { chromium } = require("playwright");
const { expect } = require("@playwright/test");

/** 4件と5件で検索欄と初期フォーカスを確認し、比較用画像を残す。 */
async function main() {
	const phase = process.argv[2] ?? "after";
	const root = `dist/ui-review/combo-threshold-${phase}-${Date.now()}`;
	await fs.mkdir(root, { recursive: true });
	const browser = await chromium.launch();
	const errors = [];
	try {
		const page = await browser.newPage();
		page.on("pageerror", (error) => errors.push(String(error)));
		for (const [theme, count] of [
			["dark2026", 4],
			["dark2026", 5],
			["light", 4],
			["light", 5],
		]) {
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
	} finally {
		await browser.close();
	}
}
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
