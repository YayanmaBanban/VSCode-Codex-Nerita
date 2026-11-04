// 実行: pnpm test:scratch guardian-review.spec.cjs --grep "ケース名"
const { expect } = require("@playwright/test");
const { test } = require("../support/scratch-test.cjs");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 明暗テーマの狭い幅で、審査結果と対象操作を確認して画像を保存する。 */
async function runCase(browser, testInfo, { theme }) {
	const directory = testInfo.outputPath("review");
	await mkdir(directory, { recursive: true });

	const errors = [];

	{
		const page = await browser.newPage({
			viewport: { width: 320, height: 800 },
		});
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.goto(
			`http://localhost:6006/iframe.html?id=chat-tool-cards--running&viewMode=story&globals=theme:${theme}`,
		);
		const card = page.locator(".tool-card").first();
		await expect(card).toBeVisible({ timeout: 30000 });
		await card.locator(".tool-heading").click();
		await expect(card).toContainText("inProgress");
		await expect(card).toContainText("pnpm.cmd --version");
		await page.screenshot({
			path: join(directory, `${theme}-started.png`),
			animations: "disabled",
		});
		await page.getByRole("button", { name: "完了通知を受信" }).click();
		await expect(card).toHaveAttribute("data-status", "completed");
		await expect(card).toContainText("バージョン確認のため承認しました。");
		await expect(card).toContainText("pnpm.cmd --version");
		await page.screenshot({
			path: join(directory, `${theme}-completed.png`),
			animations: "disabled",
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
	test(`guardian-review ${theme} @layout`, async ({
		reviewBrowser: browser,
	}, testInfo) => {
		await runCase(browser, testInfo, { theme });
	});
}
