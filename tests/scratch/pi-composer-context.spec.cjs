// 実行: pnpm test:scratch pi-composer-context.spec.cjs --grep "ケース名"
const { expect } = require("@playwright/test");
const { test } = require("../support/scratch-test.cjs");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 明暗・狭幅でコンテキストの入口と実行時エラーを確認する。 */
async function runCase(browser, testInfo, { theme }) {
	const phase = process.env.SCRATCH_PHASE ?? "after";
	const directory = testInfo.outputPath("review");
	await mkdir(directory, { recursive: true });

	const errors = [];

	{
		const page = await browser.newPage({
			viewport: { width: 420, height: 900 },
		});
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.goto(
			`http://localhost:6006/iframe.html?id=chat-app--pi&viewMode=story&globals=theme:${theme}`,
		);
		await page.getByRole("button", { name: "コンテキストを追加" }).click();
		await expect(
			page.getByRole("option", { name: "添付ファイル", exact: true }),
		).toHaveAttribute(
			"aria-disabled",
			phase === "before" ? "true" : "false",
		);
		await page.screenshot({
			path: join(directory, `${theme}-menu.png`),
		});
		await page.close();
	}
	await writeFile(
		join(directory, "errors.json"),
		JSON.stringify(errors, null, 2),
	);
	expect(errors).toEqual([]);
	console.log(directory);
}

for (const theme of ["dark2026", "light"]) {
	test(`pi-composer-context ${theme} @layout`, async ({
		reviewBrowser: browser,
	}, testInfo) => {
		await runCase(browser, testInfo, { theme });
	});
}
