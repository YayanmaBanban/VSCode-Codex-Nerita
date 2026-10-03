// Storybook 起動後、`node tests/scratch/composer-help.cjs after` で変更後の送信を確認する。変更前は引数を `before` にする。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** Ctrl+Enter による送信後のヘルプとフォーカスを明暗テーマで確認する。 */
async function main() {
	const phase = process.argv[2] ?? "after";
	const directory = join(
		"dist/ui-review",
		`composer-help-${phase}-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [];
	try {
		for (const theme of ["dark2026", "light"]) {
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
			if (phase === "after") {
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
			await page.close();
		}
		await writeFile(
			join(directory, "errors.json"),
			JSON.stringify(errors, null, 2),
		);
		expect(errors).toEqual([]);
		console.log(directory);
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
