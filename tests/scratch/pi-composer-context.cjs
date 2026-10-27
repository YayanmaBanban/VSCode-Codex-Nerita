// Storybook 起動後に `node tests/scratch/pi-composer-context.cjs before|after` でコンテキストメニューを撮影する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 明暗・狭幅でコンテキストの入口と実行時エラーを確認する。 */
async function main() {
	const phase = process.argv[2] ?? "after";
	const directory = join(
		"dist/ui-review",
		`pi-context-${phase}-${Date.now()}`,
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
				`http://localhost:6007/iframe.html?id=chat-app--pi&viewMode=story&globals=theme:${theme}`,
			);
			await page
				.getByRole("button", { name: "コンテキストを追加" })
				.click();
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
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
