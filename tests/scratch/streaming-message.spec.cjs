// 実行: pnpm test:scratch streaming-message.spec.cjs --grep "ケース名"
const { expect } = require("@playwright/test");
const { test } = require("../support/scratch-test.cjs");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 時計を制御し、文字送りの途中と、本文の確定で文字送りを打ち切った状態を明暗テーマで撮影する。 */
async function runCase(browser, testInfo, { theme }) {
	const phase = process.env.SCRATCH_PHASE ?? "after";
	const directory = testInfo.outputPath("review");
	await mkdir(directory, { recursive: true });

	const errors = [];

	{
		const page = await browser.newPage({
			viewport: { width: 360, height: 640 },
		});
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.goto(
			`http://localhost:6006/iframe.html?id=chat-messages--streaming&viewMode=story&globals=theme:${theme}`,
		);
		await expect(
			page.getByRole("button", {
				name: "100文字を受信",
				exact: true,
			}),
		).toBeVisible();
		await expect(page.locator(".message-markdown")).toHaveText(
			"あ".repeat(1000),
		);
		await page.clock.install();
		await page.clock.pauseAt(new Date(Date.now() + 1000));
		for (const length of [100, 1000]) {
			await page
				.getByRole("button", {
					name: `${length}文字を受信`,
					exact: true,
				})
				.click();
			const text = page.locator(".message-markdown");
			await page.screenshot({
				path: join(directory, `${theme}-${length}-initial.png`),
			});
			await reviewProgress(page, text, phase, directory, theme, length);
			await page.getByRole("button", { name: "全文を確定" }).click();
			await expect(text).toHaveText("あ".repeat(length));
			await page.clock.runFor(17);
			await page.screenshot({
				path: join(directory, `${theme}-${length}-completed.png`),
			});
			await page.clock.runFor(90);
			await expect(text).toHaveText("あ".repeat(length));
			await reviewAppend(page, text, length);
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
/** 追加受信で表示が巻き戻らず、結合された絵文字を1文字で表示する。 */
async function reviewAppend(page, text, length) {
	await page.getByRole("button", { name: "追記を受信" }).click();
	await page.clock.runFor(60);
	await expect(text).toHaveText(`${"あ".repeat(length)}👨‍👩‍👧‍👦`);
	await page.clock.runFor(120);
	await expect(text).toHaveText(`${"あ".repeat(length)}👨‍👩‍👧‍👦追記`);
	await page.getByRole("button", { name: "全文を確定" }).click();
}

/** 表示時刻を固定し、確定前の文字送りを検証する。 */
async function reviewProgress(page, text, phase, directory, theme, length) {
	if (phase !== "after") {
		return;
	}
	await expect(text).toHaveText("");
	for (const [stage, duration, count] of [
		["early", 60, 1],
		["middle", 523, 10],
		["late", 583, 20],
	]) {
		await page.clock.runFor(duration);
		await expect(text).toHaveText("あ".repeat(count));
		// React の DOM 更新後に描画フレームも進めてから撮影する。
		await page.clock.runFor(17);
		await page.screenshot({
			path: join(directory, `${theme}-${length}-${stage}.png`),
		});
	}
}

for (const theme of ["dark2026", "light"]) {
	test(`streaming-message ${theme} @layout`, async ({
		reviewBrowser: browser,
	}, testInfo) => {
		await runCase(browser, testInfo, { theme });
	});
}
