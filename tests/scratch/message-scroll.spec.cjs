// 実行: pnpm test:scratch message-scroll.spec.cjs --grep "ケース名"
const { expect } = require("@playwright/test");
const { test } = require("../support/scratch-test.cjs");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 明暗テーマと狭幅で、過去の閲覧・更新・末尾への復帰を確認する。 */
async function runCase(browser, testInfo, { theme }) {
	const phase = process.env.SCRATCH_PHASE ?? "after";
	const directory = testInfo.outputPath("review");
	await mkdir(directory, { recursive: true });

	const errors = [];

	await reviewTheme(browser, theme, phase, directory, errors);

	await writeFile(
		join(directory, "errors.json"),
		JSON.stringify(errors, null, 2),
	);
	expect(errors).toEqual([]);
	console.log(directory);
}

/** 指定テーマで添付表示とスクロールの状態を撮影する。 */
async function reviewTheme(browser, theme, phase, directory, errors) {
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
		`http://localhost:6006/iframe.html?id=chat-scroll-follow--updates&viewMode=story&globals=theme:${theme}`,
	);
	const conversation = page.getByRole("region", {
		name: "会話",
		exact: true,
	});
	await expect(conversation).toBeVisible({ timeout: 30000 });
	const distance = () =>
		conversation.evaluate(
			(element) =>
				element.scrollHeight - element.clientHeight - element.scrollTop,
		);
	await expect.poll(distance).toBeLessThan(5);
	const jump = page.getByRole("button", {
		name: "メッセージの末尾へ移動",
		exact: true,
	});
	await expect(jump).toHaveCount(0);
	await page.screenshot({
		path: join(directory, `${theme}-bottom.png`),
	});
	await conversation.hover();
	await page.mouse.wheel(0, -500);
	await expect.poll(distance).toBeGreaterThan(100);
	if (phase === "after") {
		await expect(jump).toBeVisible();
	}
	await page.screenshot({
		path: join(directory, `${theme}-scrolled.png`),
	});
	const top = await conversation.evaluate((element) => element.scrollTop);
	await page.getByRole("button", { name: "本文を追記" }).click();
	await expect(conversation).toContainText("追記した本文です。");
	await expect
		.poll(() => conversation.evaluate((element) => element.scrollTop))
		.toBe(top);
	if (phase === "after") {
		await jump.focus();
		await jump.press("Enter");
		await expect.poll(distance).toBeLessThan(5);
		await expect(jump).toHaveCount(0);
		await page.getByRole("button", { name: "本文を追記" }).click();
		await expect.poll(distance).toBeLessThan(5);
		await page.screenshot({
			path: join(directory, `${theme}-returned.png`),
		});
		await page.mouse.move(150, 200);
		await page.mouse.wheel(0, -100000);
		await expect(jump).toBeVisible();
		const chip = page.getByRole("button", {
			name: "育成素材と必要数量の一覧をまとめた長いファイル名.txt を開く",
			exact: true,
		});
		await expect(chip).toBeVisible();
		await expect(
			page.getByRole("button", { name: "回答の末尾へ移動" }),
		).toHaveCount(0);
		await chip.click();
		await page.screenshot({
			path: join(directory, `${theme}-attachment.png`),
		});
	}
	await page.close();
}

for (const theme of ["dark2026", "light"]) {
	test(`message-scroll ${theme} @layout`, async ({
		reviewBrowser: browser,
	}, testInfo) => {
		await runCase(browser, testInfo, { theme });
	});
}
