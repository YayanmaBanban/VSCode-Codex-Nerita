// 実行: pnpm test:scratch composer-help.spec.cjs --grep "ケース名"
const { expect } = require("@playwright/test");
const { test } = require("../support/scratch-test.cjs");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** Ctrl+Enter による送信後のヘルプとフォーカスを明暗テーマで確認する。 */
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
			`http://localhost:6006/iframe.html?id=chat-composer-symbols--search&viewMode=story&globals=theme:${theme}`,
		);
		const input = page.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		const help = page
			.locator("[role=tooltip]")
			.filter({ hasText: "Ctrl+Enter で送信" });
		await input.fill("ヘルプの送信確認");
		await expect(help).toBeVisible();
		await page.screenshot({
			path: join(directory, `${theme}-focused.png`),
		});
		await input.press("Control+Enter");
		await expect(
			page.locator("output[aria-label='送信した本文']"),
		).toHaveText("ヘルプの送信確認");
		if (phase === "after") {
			await expect(help).toBeHidden();
			await expect(input).not.toBeFocused();
		} else {
			await expect(help).toBeVisible();
		}
		await page.screenshot({
			path: join(directory, `${theme}-submitted.png`),
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
	test(`composer-help ${theme} @layout`, async ({
		reviewBrowser: browser,
	}, testInfo) => {
		await runCase(browser, testInfo, { theme });
	});
}

for (const theme of ["dark2026", "light"]) {
	test(`入力ヘルプ: 再フォーカスと Escape ${theme} @behavior`, async ({
		reviewBrowser: browser,
	}) => {
		const page = await browser.newPage({
			viewport: { width: 420, height: 900 },
		});
		const input = page.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		const help = page
			.locator("[role=tooltip]")
			.filter({ hasText: "Ctrl+Enter で送信" });
		{
			// 送信応答を持たないチャットのモックとは別に、入力欄単独で再フォーカスを確認する。
			await page.goto(
				`http://localhost:6006/iframe.html?id=chat-composer-code-block--selection&viewMode=story&globals=theme:${theme}`,
			);
			await input.fill("続けて入力");
			await expect(help).toBeVisible();
			await input.press("Control+Enter");
			await expect(help).toBeHidden();
			await expect(input).not.toBeFocused();
			await input.click();
			await expect(help).toBeVisible();
			await input.press("Escape");
			await expect(help).toBeHidden();
			await input.fill("続けて入力");
			await input.press("Enter");
			await expect(input).toBeFocused();
		}
	});
}
