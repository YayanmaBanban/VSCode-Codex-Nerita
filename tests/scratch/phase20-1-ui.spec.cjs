// 実行: pnpm test:scratch phase20-1-ui.spec.cjs --grep "ケース名"
const { expect } = require("@playwright/test");
const { test } = require("../support/scratch-test.cjs");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 通信境界のストーリーを操作し、画像と実行時エラーを保存する。 */
async function runCase(browser, testInfo, { theme, width, story }) {
	const directory = testInfo.outputPath("review");
	await mkdir(directory, { recursive: true });

	const errors = [];

	{
		const page = await browser.newPage({
			viewport: { width, height: 1000 },
		});
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await captureStories(page, [story], theme, width, directory);
		await page.close();
	}

	await writeFile(join(directory, "errors.json"), JSON.stringify(errors));
	expect(errors).toEqual([]);
	console.log(directory);
}

/** 各ストーリーが表示されてから撮影する。 */
async function captureStories(page, stories, theme, width, directory) {
	for (const story of stories) {
		await page.goto(
			`http://localhost:6006/iframe.html?id=${story}&viewMode=story&globals=theme:${theme}`,
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
const stories =
	process.env.SCRATCH_PHASE === "before"
		? ["chat-piautheditor--o-auth-pending"]
		: ["chat-piautheditor--accounts", "pi-credentials--default"];
for (const story of stories) {
	for (const theme of ["dark2026", "light"]) {
		for (const width of [390, 960]) {
			test(`資格情報: ${story} ${theme} ${width} @visual`, async ({
				reviewBrowser: browser,
			}, testInfo) => {
				await runCase(browser, testInfo, { theme, width, story });
			});
		}
	}
}
