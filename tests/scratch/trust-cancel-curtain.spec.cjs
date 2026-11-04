// 実行: pnpm test:scratch trust-cancel-curtain.spec.cjs --grep "ケース名"
const { expect } = require("@playwright/test");
const { test } = require("../support/scratch-test.cjs");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

async function runCase(browser, testInfo, { condition }) {
	const directory = testInfo.outputPath("review");
	await mkdir(directory, { recursive: true });

	const errors = [];

	await capture(browser, directory, condition, errors);

	await writeFile(join(directory, "errors.json"), JSON.stringify(errors));
	expect(errors).toEqual([]);
	console.log(directory);
}

async function capture(browser, directory, { theme, width }, errors) {
	const page = await browser.newPage({ viewport: { width, height: 950 } });
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		await page.goto(
			`http://localhost:6006/iframe.html?id=trust-manager--codex&viewMode=story&globals=theme:${theme}`,
		);
		const row = page
			.getByRole("article")
			.filter({ hasText: "projects/codex-unset" });
		await row
			.getByRole("button", { name: "信頼する", exact: true })
			.click();
		const dialog = page.getByRole("alertdialog");
		const button = dialog.getByRole("button", {
			name: "キャンセル",
			exact: true,
		});
		await expect(button).toBeVisible();
		await page.mouse.move(0, 0);
		await page.screenshot({
			path: join(directory, `${theme}-${width}-initial.png`),
		});
		await button.hover();
		await button.evaluate((element) => {
			for (const animation of element.getAnimations({ subtree: true })) {
				animation.pause();
			}
		});
		for (const time of [0, 48, 120, 220, 240]) {
			const clip = await button.evaluate((element, currentTime) => {
				for (const animation of element.getAnimations({
					subtree: true,
				})) {
					animation.currentTime = currentTime;
				}
				return globalThis.getComputedStyle(
					element.querySelector(".cancel-curtain"),
				).clipPath;
			}, time);
			await page.screenshot({
				path: join(directory, `${theme}-${width}-${time}.png`),
			});
			if (time === 240) {
				expect(clip).toContain("200%");
			}
		}
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.mouse.move(0, 0);
		await button.focus();
		await page.keyboard.press("Shift+Tab");
		await page.keyboard.press("Tab");
		await expect(button).toBeFocused();
		expect(
			await button
				.locator(".cancel-curtain")
				.evaluate(
					(element) =>
						globalThis.getComputedStyle(element).transitionDuration,
				),
		).toBe("0s");
		await page.keyboard.press("Enter");
		await expect(dialog).toBeHidden();
		await expect(
			row.getByRole("button", { name: "信頼する", exact: true }),
		).toBeEnabled();
	} finally {
		await page.close();
	}
}

const conditions = ["dark2026", "light"].flatMap((theme) =>
	[320, 900].map((width) => ({ theme, width })),
);
for (const condition of conditions) {
	test(`trust-cancel-curtain ${`${condition.theme}-${condition.width}`} @layout`, async ({
		reviewBrowser: browser,
	}, testInfo) => {
		await runCase(browser, testInfo, { condition });
	});
}
