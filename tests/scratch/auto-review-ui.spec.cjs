// 実行: pnpm test:scratch auto-review-ui.spec.cjs --grep "ケース名"
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { test } = require("../support/scratch-test.cjs");
const { expect } = require("@playwright/test");

/** 保存操作と未保存の移動確認を実画面で操作し、ページ全体の横スクロールも検査する。 */
async function review(page, root, theme, width) {
	await page.setViewportSize({ width, height: 1000 });
	await page.goto(
		`http://localhost:6006/iframe.html?id=agent-manager--settings&viewMode=story&globals=theme:${theme}`,
	);
	await page
		.getByRole("button", { name: "自動レビュー", exact: true })
		.click();
	await page.screenshot({
		path: `${root}/${theme}-${width}-manual.png`,
		fullPage: true,
	});
	await page.getByRole("combobox", { name: "承認方法" }).click();
	await page
		.getByRole("option", { name: "自動レビュー", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "保存して適用" }),
	).toBeDisabled();
	await page.getByRole("combobox", { name: "レビューモデル" }).click();
	await page.getByRole("option", { name: "GPT-6 Luna", exact: true }).click();
	await page
		.getByRole("textbox", { name: "追加の判断方針" })
		.fill("共有ブランチの変更は確認する");
	await page.getByRole("button", { name: "ハンドオフ", exact: true }).click();
	await expect(page.getByRole("alertdialog")).toBeVisible();
	await page
		.getByRole("button", { name: "編集を続ける", exact: true })
		.click();
	await expect(
		page.getByRole("textbox", { name: "追加の判断方針" }),
	).toHaveValue("共有ブランチの変更は確認する");
	await page.getByRole("button", { name: "保存して適用" }).click();
	await expect(
		page.getByRole("button", { name: "保存して適用" }),
	).toHaveCount(0);
	await page.screenshot({
		path: `${root}/${theme}-${width}-saved.png`,
		fullPage: true,
	});
	const geometry = await page.evaluate(() => ({
		width: globalThis.innerWidth,
		scrollWidth: globalThis.document.documentElement.scrollWidth,
	}));
	assert.ok(geometry.scrollWidth <= geometry.width);
	return { theme, ...geometry };
}

/** 保存済みの各判定を実カードで展開し、狭い画面でも対象操作まで確認する。 */
async function guardian(page, root, theme, width) {
	await page.setViewportSize({ width, height: 1000 });
	await page.goto(
		`http://localhost:6006/iframe.html?id=chat-tool-cards--guardian-reviews&viewMode=story&globals=theme:${theme}`,
	);
	const cards = page.getByRole("button", {
		name: /Guardian Review/,
		expanded: false,
	});
	await expect(cards).toHaveCount(4);
	while (await cards.count()) {
		await cards.first().click();
	}
	await expect(
		page.getByRole("button", { name: /Guardian Review/, expanded: true }),
	).toHaveCount(4);
	await page.screenshot({
		path: `${root}/${theme}-${width}-guardian.png`,
		fullPage: true,
	});
	const geometry = await page.evaluate(() => ({
		width: globalThis.innerWidth,
		scrollWidth: globalThis.document.documentElement.scrollWidth,
	}));
	assert.ok(geometry.scrollWidth <= geometry.width);
	return { theme, ...geometry };
}

/** 実行ごとの成果物とエラーを保存し、失敗時もブラウザーを回収する。 */
async function runCase(browser, testInfo, { theme, width, scenario }) {
	const root = testInfo.outputPath("review");
	await fs.mkdir(root, { recursive: true });

	const errors = [];
	const results = [];
	let page;
	try {
		page = await browser.newPage();
		page.on("pageerror", (error) => errors.push(String(error)));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});

		if (scenario === "自動レビュー") {
			results.push(await review(page, root, theme, width));
		}
		if (scenario === "ガーディアン") {
			results.push(await guardian(page, root, theme, width));
		}

		await fs.writeFile(
			`${root}/results.json`,
			JSON.stringify({ errors, results }, null, 2),
		);
		assert.deepEqual(errors, []);
		console.log(root);
	} catch (error) {
		await page?.screenshot({ path: `${root}/failure.png`, fullPage: true });
		throw error;
	} finally {
		// ページはケースの fixture が閉じる。
	}
}

for (const scenario of ["自動レビュー", "ガーディアン"]) {
	for (const theme of ["dark2026", "light"]) {
		for (const width of [360, 1100]) {
			test(`auto-review-ui ${theme} ${width} ${scenario} @behavior`, async ({
				reviewBrowser: browser,
			}, testInfo) => {
				await runCase(browser, testInfo, { theme, width, scenario });
			});
		}
	}
}
