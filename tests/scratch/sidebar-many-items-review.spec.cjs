// 項目数が表示高を超えたとき、一覧内で末尾までスクロールできるかを明暗テーマで確認する。
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { test } = require("../support/scratch-test.cjs");

const { expect } = require("@playwright/test");

/** 追加操作で一覧を増やし、ホイール操作前後のサイズとスクロール位置を記録する。 */
async function review(page, root, theme, phase) {
	await page.goto(
		`http://localhost:6006/iframe.html?id=pi-guardrails--editor&viewMode=story&globals=theme:${theme}`,
	);
	for (let index = 0; index < 10; index++) {
		await page.getByRole("button", { name: /ルールを追加/ }).click();
	}
	const list = page.getByRole("region", { name: "パスルール一覧" });
	await list.getByRole("button", { name: "env-files", exact: true }).click();
	const before = await list.evaluate((element) => ({
		client: element.clientHeight,
		scroll: element.scrollHeight,
		top: element.scrollTop,
	}));
	await list.hover();
	await page.mouse.wheel(0, 1000);
	if (phase === "after") {
		await expect
			.poll(() => list.evaluate((element) => element.scrollTop))
			.toBeGreaterThan(0);
		await expect(
			list.getByRole("button", { name: "path-10", exact: true }),
		).toBeInViewport();
		await list
			.getByRole("button", { name: "path-10", exact: true })
			.click();
		await expect(
			page.getByRole("textbox", { name: "ID", exact: true }),
		).toHaveValue("path-10");
	}
	const after = await list.evaluate((element) => ({
		client: element.clientHeight,
		scroll: element.scrollHeight,
		top: element.scrollTop,
	}));
	await page.screenshot({ path: `${root}/${theme}.png` });
	return { theme, before, after };
}

/** 低い画面で修正前後を比較し、検証用ブラウザーは失敗時も閉じる。 */
async function runCase(browser, testInfo, { theme }) {
	const phase = process.env.SCRATCH_PHASE ?? "after";
	const root = testInfo.outputPath("review");
	await fs.mkdir(root, { recursive: true });

	const errors = [];
	const results = [];
	{
		const page = await browser.newPage({
			viewport: { width: 1200, height: 520 },
		});
		page.on("pageerror", (error) => errors.push(String(error)));

		results.push(await review(page, root, theme, phase));

		assert.deepEqual(errors, []);
		await fs.writeFile(
			`${root}/results.json`,
			JSON.stringify({ results, errors }, null, 2),
		);
		console.log(JSON.stringify({ root, results }));
	}
}

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

for (const theme of ["dark2026", "light"]) {
	test(`sidebar-many-items-review ${theme} @layout`, async ({
		reviewBrowser: browser,
	}, testInfo) => {
		await runCase(browser, testInfo, { theme });
	});
}
