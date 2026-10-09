// Storybook 起動後、node tests/scratch/agent-card-chips.cjs before|after でカードとパルスの表示を確認する。
const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 明暗・狭幅の結果を実行ごとに保存し、ブラウザーのエラーも確認する。 */
async function main() {
	const phase = process.argv[2] ?? "after";
	const directory = join(
		"dist/ui-review",
		`agent-card-${phase}-${Date.now()}`,
	);
	await mkdir(directory, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			for (const width of [320, 640]) {
				await reviewCards(
					browser,
					{ theme, width, phase, directory },
					errors,
				);
			}
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

/** 製品カードの全状態を描画し、変更後はチップと動きの軽減設定も確認する。 */
async function reviewCards(
	browser,
	{ theme, width, phase, directory },
	errors,
) {
	const page = await browser.newPage({ viewport: { width, height: 1100 } });
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	await page.goto(
		`http://localhost:6007/iframe.html?id=chat-agents--states&viewMode=story&globals=theme:${theme}`,
	);
	const cards = page.locator(".agent-card");
	await expect(cards).toHaveCount(9, { timeout: 30000 });
	await expect(cards.first()).toBeVisible();
	const prefix = join(directory, `${theme}-${width}`);
	await page.screenshot({ path: `${prefix}.png`, fullPage: true });
	if (phase === "after") {
		await expect(cards.first().locator(".agent-chip")).toHaveText([
			"reviewer",
			"reviewer",
			"GPT-5.x",
			"High",
		]);
		await expect(page.locator(".agent-status-dots")).toHaveCount(4);
		await reviewPulse(page, prefix);
		await page.emulateMedia({ reducedMotion: "reduce" });
		const count = await page
			.locator(".agent-status-dots")
			.first()
			.evaluate(
				(element) => element.getAnimations({ subtree: true }).length,
			);
		expect(count).toBe(0);
		await page.screenshot({
			path: `${prefix}-reduced.png`,
			fullPage: true,
		});
	}
	await page.close();
}

/** 1 周期の進行時刻を固定し、白・黄の共通パルスを同じ条件で比較する。 */
async function reviewPulse(page, prefix) {
	const frames = [];
	for (const time of [0, 150, 600, 1050, 1200]) {
		const opacity = await page
			.locator(".agent-status-dots")
			.evaluateAll((elements, currentTime) => {
				return elements.map((element) => {
					for (const animation of element.getAnimations({
						subtree: true,
					})) {
						animation.pause();
						animation.currentTime = currentTime;
					}
					const values = [];
					for (const dot of element.children) {
						values.push(
							dot.ownerDocument.defaultView.getComputedStyle(dot)
								.opacity,
						);
					}
					return values;
				});
			}, time);
		frames.push({ time, opacity });
		await page.screenshot({
			path: `${prefix}-pulse-${time}.png`,
			fullPage: true,
		});
	}
	await writeFile(`${prefix}-frames.json`, JSON.stringify(frames, null, 2));
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
