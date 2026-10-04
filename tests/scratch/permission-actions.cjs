// Storybook 起動後、`node tests/scratch/permission-actions.cjs before|after [plan]` でカーテンを確認する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

const plan = process.argv[3] === "plan";
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

/** 明暗テーマと狭い幅で、権限またはプランの選択ボタンのカーテンとフォーカス表示を確認する。 */
async function reviewTheme(browser, theme, phase, directory, errors) {
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
async function main() {
	const phase = process.argv[2] ?? "after";
	const directory = join(
		"dist/ui-review",
		`${plan ? "plan" : "permission"}-actions-${phase}-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			await reviewTheme(browser, theme, phase, directory, errors);
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
		frames.push(
			await curtain.evaluate((element, time) => {
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
			}, time),
		);
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

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
