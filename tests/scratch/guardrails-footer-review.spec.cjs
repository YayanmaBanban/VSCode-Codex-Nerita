// 実行: pnpm test:scratch guardrails-footer-review.spec.cjs --grep "ケース名"
// 状態別フッターと、狭い画面・長い警告で編集欄を隠さないことを確認する。
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { test } = require("../support/scratch-test.cjs");
const { expect } = require("@playwright/test");

/** フッターの実寸と本文の予約領域を比較し、画面外へのはみ出しを検出する。 */
async function capture(page, root, name, story) {
	const footer = page.locator("footer");
	if (story === "editor" || story === "long-inspection-warnings") {
		await expect(footer).toHaveAttribute("inert", "");
	} else {
		await expect(footer).toHaveAttribute("data-phase", "shown");
		await expect(footer).toHaveCSS("opacity", "1");
		const bounds = await footer.boundingBox();
		const pane = await page.locator(".guardrails-panes").boundingBox();
		assert.ok(pane.y + pane.height <= bounds.y + 1, name);
		assert.ok(
			bounds.x >= 0 &&
				bounds.x + bounds.width <= page.viewportSize().width + 1,
			name,
		);
	}
	await page.screenshot({ path: `${root}/${name}.png` });
}

/** 外部境界だけを代替したストーリーを使い、フッター内の操作と明暗の表示を確認する。 */
async function runCase(browser, testInfo, { theme, width, story }) {
	const root = testInfo.outputPath("review");
	await fs.mkdir(root, { recursive: true });

	const errors = [];
	{
		const page = await browser.newPage();
		page.on("pageerror", (error) => errors.push(String(error)));

		await page.setViewportSize({ width, height: 700 });

		await page.goto(
			`http://localhost:6006/iframe.html?id=pi-guardrails--${story}&viewMode=story&globals=theme:${theme}`,
		);
		await page.getByRole("heading", { name: "Pi ガードレール" }).waitFor();
		await capture(page, root, `${theme}-${width}-${story}`, story);

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
	for (const story of [
		"editor",
		"unsaved-changes",
		"unapplied-changes",
		"save-error",
		"save-pending",
		"long-inspection-warnings",
	]) {
		test(`guardrails-footer-review ${theme} ${width} ${typeof story === "string" ? story : story.id} @layout`, async ({
			reviewBrowser: browser,
		}, testInfo) => {
			await runCase(browser, testInfo, { theme, width, story });
		});
	}
}
