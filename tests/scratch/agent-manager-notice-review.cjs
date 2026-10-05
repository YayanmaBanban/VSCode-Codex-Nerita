// Storybook 起動後に `node tests/scratch/agent-manager-notice-review.cjs before|after` で実行する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

/** 未保存の変更を確認する通知を、明暗テーマと表示幅ごとに撮影する。 */
async function main() {
	const phase = process.argv[2] ?? "after";
	const root = `dist/ui-review/agent-manager-notice-${phase}-${Date.now()}`;
	await fs.mkdir(root, { recursive: true });
	const browser = await chromium.launch();
	const errors = [];
	try {
		const page = await browser.newPage();
		await page.clock.install();
		page.on("pageerror", (error) => errors.push(String(error)));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		for (const [theme, width] of [
			["dark2026", 1100],
			["light", 420],
		]) {
			await page.setViewportSize({ width, height: 950 });
			await page.goto(
				`http://localhost:6007/iframe.html?id=agent-manager--codex&viewMode=story&globals=theme:${theme}`,
			);
			await page
				.getByRole("textbox", { name: "名前", exact: true })
				.fill("edited-agent");
			await page
				.getByRole("button", { name: "ハンドオフ", exact: true })
				.click();
			await page.mouse.move(0, 0);
			const notice = page.getByRole(
				phase === "before" ? "alertdialog" : "region",
				{ name: "未保存の変更" },
			);
			await notice.waitFor();
			await notice.evaluate(async (element) => {
				await Promise.all(
					element
						.getAnimations({ subtree: true })
						.map((animation) => animation.finished),
				);
			});
			await page.screenshot({
				path: `${root}/${theme}-${width}.png`,
				fullPage: true,
			});
			const layout = await page.evaluate(() => ({
				width: globalThis.innerWidth,
				scrollWidth: globalThis.document.documentElement.scrollWidth,
			}));
			assert.ok(layout.scrollWidth <= layout.width);
			if (phase === "after") {
				await page.clock.pauseAt(
					new Date(await page.evaluate(() => Date.now() + 100)),
				);
			}
			await page
				.getByRole("button", { name: "編集を続ける", exact: true })
				.evaluate((element) => element.click());
			if (phase === "after") {
				await reviewExit(page, root, `${theme}-${width}`);
				await page.clock.resume();
			}
			assert.equal(
				await page
					.getByRole("textbox", { name: "名前", exact: true })
					.inputValue(),
				"edited-agent",
			);
		}
		await fs.writeFile(`${root}/errors.json`, JSON.stringify(errors));
		assert.deepEqual(errors, []);
		console.log(root);
	} finally {
		await browser.close();
	}
}

/** 退場中の透明度と操作不可の状態を、開始・中間・完了で確認する。 */
async function reviewExit(page, root, label) {
	const notice = page.locator('section[aria-label="未保存の変更"]');
	const samples = [];
	await page.clock.runFor(16);
	for (const progress of [0, 0.5]) {
		samples.push(
			await notice.evaluate((element, fraction) => {
				const animations = element.getAnimations();
				for (const animation of animations) {
					animation.pause();
					animation.currentTime =
						Number(animation.effect.getTiming().duration) *
						fraction;
				}
				return {
					opacity: Number(
						globalThis.getComputedStyle(element).opacity,
					),
					inert: element.inert,
				};
			}, progress),
		);
		await page.screenshot({
			path: `${root}/${label}-exit-${progress}.png`,
			fullPage: true,
		});
		await page.clock.runFor(100);
	}
	assert.equal(samples[0].inert, true);
	assert.ok(
		samples[1].opacity > 0 && samples[1].opacity < samples[0].opacity,
	);
	await notice.evaluate((element) => {
		for (const animation of element.getAnimations()) {
			animation.finish();
		}
	});
	await page.clock.runFor(250);
	await notice.waitFor({ state: "detached" });
	await page.screenshot({
		path: `${root}/${label}-exit-complete.png`,
		fullPage: true,
	});
	await fs.writeFile(`${root}/${label}-exit.json`, JSON.stringify(samples));
}
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
