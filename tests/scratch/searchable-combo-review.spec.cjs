// 多数の候補を持つ共通コンボの検索・選択と、明暗・幅別の表示を確認する。
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { test } = require("../support/scratch-test.cjs");
const { expect } = require("@playwright/test");

/** 候補数が多くても検索でき、再表示時に全候補と現在値を確認できることを検証する。 */
async function review(page, root, name) {
	const trigger = page.getByRole("combobox", { name: "候補", exact: true });
	await trigger.click();
	const panel = page.getByRole("dialog", { name: "候補を検索" });
	const search = panel.getByRole("searchbox");
	await expect(search).toBeFocused();
	await expect
		.poll(async () => {
			const triggerBounds = await trigger.boundingBox();
			const panelBounds = await panel.boundingBox();
			return Math.abs(triggerBounds.width - panelBounds.width);
		})
		.toBeLessThan(1);
	await expect(panel.getByRole("option")).toHaveCount(120);
	await page.screenshot({ path: `${root}/${name}-all.png` });
	await search.fill("候補の説明 120");
	await expect(panel.getByRole("option")).toHaveCount(1);
	await page.screenshot({ path: `${root}/${name}-filtered.png` });
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Enter");
	await expect(trigger).toHaveText("Item 120");
	await expect(panel).toHaveCount(0);
	await trigger.click();
	await expect(search).toHaveValue("");
	await expect(
		panel.getByRole("option", { name: "Item 120", exact: true }),
	).toHaveAttribute("aria-selected", "true");
	await search.fill("unmatched-query");
	await expect(panel.getByRole("option")).toHaveCount(0);
	await page.screenshot({ path: `${root}/${name}-empty.png` });
	await page.keyboard.press("Escape");
	await expect(trigger).toBeFocused();
}

/** 製品の部品をストーリーで開き、描画エラーとページ全体のはみ出しも記録する。 */
async function runCase(browser, testInfo, { theme, width }) {
	const root = testInfo.outputPath("review");
	await fs.mkdir(root, { recursive: true });

	const errors = [];
	{
		const page = await browser.newPage();
		page.on("pageerror", (error) => errors.push(String(error)));

		await page.setViewportSize({ width, height: 950 });
		await page.goto(
			`http://localhost:6006/iframe.html?id=ui-searchablecombolist--editor&viewMode=story&globals=theme:${theme}`,
		);
		await review(page, root, `${theme}-${width}`);
		assert.equal(
			await page.evaluate(
				() =>
					globalThis.document.documentElement.scrollWidth >
					globalThis.innerWidth,
			),
			false,
		);

		assert.deepEqual(errors, []);
		await fs.writeFile(
			`${root}/results.json`,
			JSON.stringify({ errors }, null, 2),
		);
		console.log(root);
	}
}

for (const [theme, width] of [
	["dark2026", 1200],
	["dark2026", 360],
	["light", 1200],
	["light", 360],
]) {
	test(`searchable-combo-review ${theme} ${width} @layout`, async ({
		reviewBrowser: browser,
	}, testInfo) => {
		await runCase(browser, testInfo, { theme, width });
	});
}
