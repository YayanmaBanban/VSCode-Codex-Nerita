// 実行: pnpm test:scratch agent-stop-ui.spec.cjs --grep "ケース名"
const { expect } = require("@playwright/test");
const { test } = require("../support/scratch-test.cjs");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 明暗テーマ・狭幅で通常、要求中、失敗、停止後の画面と実行時エラーを保存する。 */
async function runCase(browser, testInfo, { theme, width }) {
	const directory = testInfo.outputPath("review");
	await mkdir(directory, { recursive: true });

	const errors = [];

	await reviewStop(browser, directory, theme, width, errors);

	await writeFile(join(directory, "errors.json"), JSON.stringify(errors));
	expect(errors).toEqual([]);
	console.log(directory);
}

/** 実装の停止要求を記録し、Host の失敗と成功を通信境界へ注入する。 */
async function reviewStop(browser, directory, theme, width, errors) {
	const page = await browser.newPage({ viewport: { width, height: 760 } });
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	await page.goto(
		`http://localhost:6006/iframe.html?id=chat-agents--viewer&viewMode=story&globals=theme:${theme}`,
	);
	await page.getByRole("button", { name: /swift-cheetahの会話/ }).click();
	const stop = page.getByRole("button", { name: "自身と子を停止" });
	await expect(stop).toBeVisible();
	const prefix = join(directory, `${theme}-${width}`);
	await page.screenshot({ path: `${prefix}-ready.png` });
	await stop.click();
	await expect(
		page.getByRole("button", { name: "停止要求中…" }),
	).toBeDisabled();
	await page.screenshot({ path: `${prefix}-pending.png` });
	await page.evaluate(() => {
		const bridge =
			globalThis.document.querySelector("[data-story-chat]").storyBridge;
		const request = bridge.sent
			.filter((message) => message.type === "agent/stop")
			.at(-1);
		bridge.emit({
			type: "request/failed",
			requestId: request.requestId,
			error: "停止できませんでした。表示を更新して再試行してください。",
		});
	});
	await expect(page.getByRole("alert")).toHaveCount(1);
	await expect(stop).toBeEnabled();
	await page.screenshot({ path: `${prefix}-failed.png` });
	await stop.click();
	await expect(
		page.getByRole("button", { name: "停止要求中…" }),
	).toBeDisabled();
	await page.evaluate(() => {
		const bridge =
			globalThis.document.querySelector("[data-story-chat]").storyBridge;
		const request = bridge.sent
			.filter((message) => message.type === "agent/stop")
			.at(-1);
		bridge.emit({
			type: "agent/stopped",
			requestId: request.requestId,
			threadId: request.threadId,
		});
	});
	await expect(stop).toBeEnabled();
	await expect(page.getByRole("alert")).toHaveCount(0);
	await page.screenshot({ path: `${prefix}-accepted.png` });
	await page.close();
}

for (const theme of ["dark2026", "light"]) {
	for (const width of [320, 640]) {
		test(`agent-stop-ui ${theme} ${width} @layout`, async ({
			reviewBrowser: browser,
		}, testInfo) => {
			await runCase(browser, testInfo, { theme, width });
		});
	}
}
