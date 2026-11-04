// 実行: pnpm test:scratch permission-actions.spec.cjs --grep "ケース名"
const { expect } = require("@playwright/test");
const { test } = require("../support/scratch-test.cjs");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 明暗テーマと狭い幅で、権限またはプランの選択ボタンのカーテンとフォーカス表示を確認する。 */
async function reviewTheme(browser, theme, phase, directory, errors, plan) {
	const story = plan
		? "chat-plan-decision--completed"
		: "chat-app--app-server-permission";
	const region = plan ? "Planの実装" : "承認要求";
	const actions = plan
		? [
				["新規セッションで実装する", "new"],
				["プランを続ける", "continue"],
			]
		: [
				["拒否", "deny"],
				["ターンを中止", "abort"],
			];
	const primaryName = plan ? "このセッションで実装する" : "今回のみ許可";
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
		`http://localhost:6006/iframe.html?id=${story}&viewMode=story&globals=theme:${theme}`,
	);
	const card = page.getByRole("region", { name: region });
	await expect(card).toBeVisible();
	await page.screenshot({
		path: join(directory, `${theme}-initial.png`),
	});
	for (const [name, action] of actions) {
		const button = card.getByRole("button", { name, exact: true });
		await button.hover();
		if (phase === "after") {
			await captureCurtain(page, button, directory, `${theme}-${action}`);
			await page.mouse.move(0, 0);
			await button.focus();
			await expect(button.locator("span[aria-hidden]")).toHaveCSS(
				"clip-path",
				"polygon(0px 0px, 200% 0px, 0px 200%)",
			);
		}
		await page.screenshot({
			path: join(directory, `${theme}-${action}-focused.png`),
		});
		await button.evaluate((element) => element.blur());
	}
	if (phase === "after") {
		await expect(
			card
				.getByRole("button", { name: primaryName })
				.locator("span[aria-hidden]"),
		).toHaveCount(0);
		await page.emulateMedia({ reducedMotion: "reduce" });
		const deny = card.getByRole("button", {
			name: actions[0][0],
			exact: true,
		});
		await deny.hover();
		await expect(deny.locator("span[aria-hidden]")).toHaveCSS(
			"transition-property",
			"none",
		);
	}
	await page.close();
}

/** テーマごとの撮影結果と実行エラーをまとめる。 */
async function runCase(browser, testInfo, { theme, plan }) {
	const phase = process.env.SCRATCH_PHASE ?? "after";
	const directory = testInfo.outputPath("review");
	await mkdir(directory, { recursive: true });

	const errors = [];

	await reviewTheme(browser, theme, phase, directory, errors, plan);

	await writeFile(
		join(directory, "errors.json"),
		JSON.stringify(errors, null, 2),
	);
	expect(errors).toEqual([]);
	console.log(directory);
}

/** カーテンを停止し、開始から完了までの形状と色を記録する。 */
async function captureCurtain(page, button, directory, prefix) {
	const curtain = button.locator("span[aria-hidden]");
	await curtain.evaluate((element) => {
		for (const animation of element.getAnimations()) {
			animation.pause();
		}
	});
	const frames = [];
	for (const [name, time] of [
		["initial", 0],
		["early", 30],
		["middle", 150],
		["late", 270],
		["completed", 300],
	]) {
		const sampleCurtain = (element, time) => {
			const animations = element.getAnimations();
			for (const animation of animations) {
				animation.currentTime = time;
			}
			const style = globalThis.getComputedStyle(element);
			return {
				time,
				animations: animations.length,
				clipPath: style.clipPath,
				background: style.backgroundColor,
				color: style.color,
			};
		};
		frames.push(await curtain.evaluate(sampleCurtain, time));
		await page.screenshot({
			path: join(directory, `${prefix}-${name}.png`),
			animations: "allow",
		});
	}
	expect(frames[0].animations).toBeGreaterThan(0);
	expect(frames[2].clipPath).not.toBe(frames[0].clipPath);
	expect(frames[2].clipPath).not.toBe(frames[4].clipPath);
	await writeFile(
		join(directory, `${prefix}.json`),
		JSON.stringify(frames, null, 2),
	);
	await curtain.evaluate((element) => {
		for (const animation of element.getAnimations()) {
			animation.finish();
		}
	});
}
for (const plan of [false, true]) {
	for (const theme of ["dark2026", "light"]) {
		test(`承認操作: ${plan ? "プラン" : "権限"} ${theme} @animation`, async ({
			reviewBrowser: browser,
		}, testInfo) => {
			await runCase(browser, testInfo, { theme, plan });
		});
	}
}
