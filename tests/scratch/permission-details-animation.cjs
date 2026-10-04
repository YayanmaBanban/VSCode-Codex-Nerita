// Storybook 起動後、`node tests/scratch/permission-details-animation.cjs before|after` で詳細の開閉を確認する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 明暗テーマと狭い幅で、詳細欄のキーボード操作と開閉アニメーションの途中を確認する。 */
async function main() {
	const phase = process.argv[2] ?? "after";
	const directory = join(
		"dist/ui-review",
		`permission-details-${phase}-${Date.now()}`,
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

/** 実際の CSS トランジションを停止し、各時刻の高さを撮影する。 */
async function captureTransition(page, directory, prefix, trigger) {
	const contentId = await trigger.getAttribute("aria-controls");
	const content = page.locator(`[id="${contentId}"]`);
	await content.evaluate((element) => {
		for (const animation of element.getAnimations()) {
			animation.pause();
		}
	});
	const frames = [];
	for (const [name, time] of [
		["initial", 0],
		["early", 22],
		["middle", 110],
		["late", 198],
		["completed", 220],
	]) {
		frames.push(
			await content.evaluate((element, time) => {
				const animations = element.getAnimations();
				for (const animation of animations) {
					animation.currentTime = time;
				}
				return {
					time,
					height: element.getBoundingClientRect().height,
					animations: animations.length,
				};
			}, time),
		);
		await page.screenshot({
			path: join(directory, `${prefix}-${name}.png`),
			animations: "allow",
		});
	}
	expect(frames[0].animations).toBeGreaterThan(0);
	expect(frames[0].height).not.toBe(frames[4].height);
	expect(frames[2].height).toBeGreaterThan(
		Math.min(frames[0].height, frames[4].height),
	);
	expect(frames[2].height).toBeLessThan(
		Math.max(frames[0].height, frames[4].height),
	);
	await writeFile(
		join(directory, `${prefix}.json`),
		JSON.stringify(frames, null, 2),
	);
	await content.evaluate((element) => {
		for (const animation of element.getAnimations()) {
			animation.finish();
		}
	});
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});

/** 1つのテーマで開閉と動きを減らす設定を確認する。 */
async function reviewTheme(browser, theme, phase, directory, errors) {
	const page = await browser.newPage({
		viewport: { width: 420, height: 1000 },
	});
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	await page.goto(
		`http://localhost:6006/iframe.html?id=chat-permission--long-command&viewMode=story&globals=theme:${theme}`,
	);
	const trigger =
		phase === "before"
			? page.locator("summary")
			: page.getByRole("button", { name: "詳細 (2)" });
	await expect(trigger).toBeVisible();
	await page.screenshot({
		path: join(directory, `${theme}-initial.png`),
	});
	await trigger.click();
	if (phase === "after") {
		await captureTransition(page, directory, `${theme}-opening`, trigger);
	}
	await expect(page.getByText("10000 ms", { exact: true })).toBeVisible();
	await page.screenshot({
		path: join(directory, `${theme}-opened.png`),
	});
	await trigger.focus();
	await trigger.press("Enter");
	if (phase === "after") {
		await captureTransition(page, directory, `${theme}-closing`, trigger);
		await expect(trigger).toHaveAttribute("aria-expanded", "false");
	}
	if (phase === "before") {
		await expect(page.getByText("10000 ms", { exact: true })).toBeHidden();
	} else {
		const contentId = await trigger.getAttribute("aria-controls");
		await expect(page.locator(`[id="${contentId}"]`)).toHaveCSS(
			"grid-template-rows",
			"0px",
		);
	}
	await page.screenshot({
		path: join(directory, `${theme}-closed.png`),
	});
	if (phase === "after") {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await trigger.press("Space");
		await expect(trigger).toHaveAttribute("aria-expanded", "true");
		await expect(page.getByText("10000 ms", { exact: true })).toBeVisible();
		await trigger.press("Space");
		const contentId = await trigger.getAttribute("aria-controls");
		await expect(page.locator(`[id="${contentId}"]`)).toHaveAttribute(
			"inert",
			"",
		);
		await expect(page.locator(`[id="${contentId}"]`)).toHaveCSS(
			"grid-template-rows",
			"0px",
		);
	}
	await page.close();
}
