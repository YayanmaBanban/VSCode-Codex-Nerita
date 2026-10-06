// Storybook の資格情報画面を明暗テーマ・狭い表示幅で撮影する。実行方法: `node tests/scratch/phase20-1-ui.cjs [before]`。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 通信境界のストーリーを操作し、画像と実行時エラーを保存する。 */
async function main() {
	const before = process.argv[2] === "before";
	const directory = join(
		"dist/ui-review",
		`phase20-1-${before ? "before" : "after"}-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			for (const width of [390, 960]) {
				const page = await browser.newPage({
					viewport: { width, height: 1000 },
				});
				page.on("pageerror", (error) => errors.push(error.message));
				page.on("console", (message) => {
					if (message.type() === "error") {
						errors.push(message.text());
					}
				});
				const stories = before
					? ["chat-piautheditor--o-auth-pending"]
					: [
							"chat-piautheditor--accounts",
							"pi-credentials--default",
						];
				await captureStories(page, stories, theme, width, directory);
				await page.close();
			}
		}
		await writeFile(join(directory, "errors.json"), JSON.stringify(errors));
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
/** 各ストーリーが表示されてから撮影する。 */
async function captureStories(page, stories, theme, width, directory) {
	for (const story of stories) {
		await page.goto(
			`http://localhost:6010/iframe.html?id=${story}&viewMode=story&globals=theme:${theme}`,
		);
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		await page.evaluate(() =>
			Promise.all(
				globalThis.document
					.getAnimations()
					.map((animation) => animation.finished),
			),
		);
		await page.screenshot({
			path: join(directory, `${theme}-${width}-${story}.png`),
			fullPage: true,
		});
	}
}
