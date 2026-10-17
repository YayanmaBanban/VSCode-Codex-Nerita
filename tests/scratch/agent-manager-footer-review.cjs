// Storybook 起動後に `node tests/scratch/agent-manager-footer-review.cjs` で実行する。
// 仮想時計で保存後の待機を進め、CSS 遷移は WAAPI で時刻を指定して撮影する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

/** 入退場の途中を停止して撮影し、完了時の状態を確認する。 */
async function sampleTransition(page, directory, name, duration) {
	const footer = page.locator("footer");
	const animations = await footer.evaluate((element) => {
		const animations = element.getAnimations();
		for (const animation of animations) {
			animation.pause();
		}
		return animations.length;
	});
	assert.ok(animations > 0, `${name}: 遷移が開始していること`);
	const samples = [];
	for (const [phase, fraction] of [
		["initial", 0],
		["early", 0.2],
		["middle", 0.5],
		["late", 0.8],
		["completed", 1],
	]) {
		const time = duration * fraction;
		samples.push(
			await footer.evaluate((element, time) => {
				for (const animation of element.getAnimations()) {
					animation.currentTime = time;
				}
				return {
					time,
					opacity: Number(
						globalThis.getComputedStyle(element).opacity,
					),
				};
			}, time),
		);
		await page.screenshot({
			path: `${directory}/${name}-${phase}.png`,
			clip: { x: 0, y: 590, width: 420, height: 110 },
		});
	}
	await footer.evaluate((element) => {
		for (const animation of element.getAnimations()) {
			animation.finish();
		}
	});
	await page.clock.runFor(16);
	return samples;
}

/** 実コンポーネントを開き直して、保存応答前後の時間を固定する。 */
async function openEditor(page, theme, story) {
	await page.clock.resume();
	await page.goto(
		`http://localhost:6006/iframe.html?id=agent-manager--${story === "handoff" ? "codex" : story}&viewMode=story&globals=theme:${theme}`,
	);
	await page.getByRole("textbox", { name: "説明", exact: true }).waitFor();
	if (story === "handoff") {
		await page
			.getByRole("button", { name: "ハンドオフ", exact: true })
			.click();
	}
	await page.clock.pauseAt(
		new Date(await page.evaluate(() => Date.now() + 1)),
	);
}

/** 保存応答を待ち、フッターに保存済み状態が現れたところから計測する。 */
async function save(page, story) {
	await page
		.getByRole("button", {
			name: story === "handoff" ? "ハンドオフ設定を保存" : "変更を保存",
			exact: true,
		})
		.evaluate((element) => element.click());
	await page.locator("footer .lucide-circle-check").waitFor();
	await page.locator("footer .lucide-circle-check").evaluate((element) => {
		for (const animation of element.parentElement.getAnimations()) {
			animation.finish();
		}
	});
}

/** 1つのテーマで、初回表示・保存後の退場・再編集・退場中の割り込みを確認する。 */
async function reviewTheme(page, theme, story, directory) {
	await openEditor(page, theme, story);
	const label = `${story}-${theme}`;
	const footer = page.locator("footer");
	const description = page.getByRole(
		story === "handoff" ? "spinbutton" : "textbox",
		{
			name: story === "handoff" ? "タイムアウト（秒）" : "説明",
			exact: true,
		},
	);
	assert.equal(await footer.getAttribute("data-phase"), "hidden");
	assert.equal(await footer.getAttribute("inert"), "");

	const firstEdit = {
		codex: { name: "説明", value: "初回の編集" },
		settings: { name: "名前", value: "renamed-writer" },
		handoff: { name: "タイムアウト（秒）", value: "121" },
	}[story];
	const firstField = page.getByRole(
		story === "handoff" ? "spinbutton" : "textbox",
		{
			name: firstEdit.name,
			exact: true,
		},
	);
	await firstField.fill(firstEdit.value);
	assert.equal(await footer.getAttribute("data-phase"), "shown");
	const entrance = await sampleTransition(
		page,
		directory,
		`${label}-enter`,
		300,
	);
	assert.equal(entrance[0].opacity, 0);
	assert.equal(entrance.at(-1).opacity, 1);
	await save(page, story);
	assert.equal(await page.getByRole("status").count(), 1);
	await page.clock.runFor(1999);
	assert.equal(await footer.getAttribute("data-phase"), "shown");
	await page.clock.runFor(1);
	assert.equal(await footer.getAttribute("data-phase"), "leaving");
	const exit = await sampleTransition(page, directory, `${label}-exit`, 200);
	assert.equal(exit[0].opacity, 1);
	assert.equal(exit.at(-1).opacity, 0);
	assert.equal(await footer.getAttribute("data-phase"), "hidden");
	assert.equal(await footer.getAttribute("inert"), "");

	await description.fill(story === "handoff" ? "122" : "再表示の編集");
	await sampleTransition(page, directory, `${label}-reenter`, 300);
	await save(page, story);
	await page.clock.runFor(1000);
	await description.fill(story === "handoff" ? "123" : "待機中の再編集");
	await page.clock.runFor(2000);
	assert.equal(await footer.getAttribute("data-phase"), "shown");
	assert.equal(await footer.locator(".lucide-badge-alert").count(), 1);

	await save(page, story);
	await page.clock.runFor(2000);
	assert.equal(await footer.getAttribute("data-phase"), "leaving");
	await footer.evaluate((element) => {
		for (const animation of element.getAnimations()) {
			animation.pause();
			animation.currentTime = 100;
		}
	});
	await description.click();
	assert.equal(await footer.getAttribute("data-phase"), "shown");
	assert.equal(await footer.getAttribute("data-instant"), "true");
	const interrupted = await footer.evaluate((element) => ({
		opacity: globalThis.getComputedStyle(element).opacity,
		animations: element.getAnimations().length,
	}));
	assert.equal(interrupted.opacity, "1");
	assert.equal(interrupted.animations, 0);
	await page.clock.runFor(3000);
	assert.equal(await footer.getAttribute("data-phase"), "shown");
	await page.screenshot({
		path: `${directory}/${label}-interrupted.png`,
	});
	return { theme, story, entrance, exit, interrupted };
}

/** 再編集と退場中の操作が、非表示処理を取り消すことを明暗テーマで確認する。 */
async function main() {
	const directory = `dist/ui-review/agent-manager-footer-${Date.now()}`;
	await fs.mkdir(directory, { recursive: true });
	const browser = await chromium.launch();
	const errors = [];
	const results = [];
	try {
		const page = await browser.newPage({
			viewport: { width: 420, height: 700 },
		});
		await page.clock.install();
		page.on("pageerror", (error) => errors.push(String(error)));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		for (const [theme, story] of [
			["dark2026", "codex"],
			["light", "codex"],
			["dark2026", "settings"],
			["light", "settings"],
			["dark2026", "handoff"],
			["light", "handoff"],
		]) {
			results.push(await reviewTheme(page, theme, story, directory));
		}
		assert.deepEqual(errors, []);
		await fs.writeFile(
			`${directory}/results.json`,
			JSON.stringify({ results, errors }, null, 2),
		);
		console.log(directory);
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
