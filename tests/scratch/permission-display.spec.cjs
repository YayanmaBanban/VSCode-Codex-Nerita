// 実行: pnpm test:scratch permission-display.spec.cjs --grep "ケース名"
const { expect } = require("@playwright/test");
const { test } = require("../support/scratch-test.cjs");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** Host の権限値に対応する表示を、既存ストーリーで明暗テーマごとに確認する。 */
async function runCase(browser, testInfo, { theme, story, label, value }) {
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
		{
			await page.goto(
				`http://localhost:6006/iframe.html?id=chat-composer-settings--${story}&viewMode=story&globals=theme:${theme}`,
			);
			await page
				.getByRole("button", { name: "Mode", exact: true })
				.click();
			const slider = page.getByRole("slider", {
				name: "Mode",
				exact: true,
			});
			await expect(slider).toBeVisible();
			await page.screenshot({
				path: join(directory, `${theme}-${story}.png`),
			});
			await expect(slider).toHaveValue(value);
			await expect(slider).toHaveAttribute("aria-valuetext", label);
		}
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
	for (const [story, label, value] of [
		["workspace-write-user", "ワークスペース内に書き込み", "1"],
		["full-access", "フルアクセス", "2"],
	]) {
		test(`permission-display ${theme} ${typeof story === "string" ? story : story.id} ${label} ${value} @layout`, async ({
			reviewBrowser: browser,
		}, testInfo) => {
			await runCase(browser, testInfo, { theme, story, label, value });
		});
	}
}
