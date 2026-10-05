// Storybook 起動後に実行し、結果不明カードと固定 DTO の設定画面を明暗・幅ごとに撮影する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

/** 製品コンポーネントの表示を撮影し、適用テーマと実行時エラーを記録する。 */
async function main() {
	const root = `dist/ui-review/implementation-review-${Date.now()}`;
	await fs.mkdir(root, { recursive: true });
	const browser = await chromium.launch();
	const errors = [];
	const metrics = [];
	try {
		const page = await browser.newPage();
		page.on("pageerror", (error) => errors.push(String(error)));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		for (const [theme, width] of [
			["dark2026", 1100],
			["dark2026", 320],
			["light", 320],
		]) {
			await page.setViewportSize({ width, height: 650 });
			for (const story of [
				"chat-tool-cards--unknown-result",
				"chat-personality--configured",
				"chat-piautheditor--providers",
			]) {
				metrics.push(
					await captureStory(page, root, story, theme, width),
				);
			}
		}
		assert.deepEqual(errors, []);
		await fs.writeFile(
			`${root}/metrics.json`,
			JSON.stringify(metrics, null, 2),
		);
		console.log(root);
	} finally {
		await browser.close();
	}
}

/** 入力 DTO に対応する表示を待ち、折りたたみの説明を展開して記録する。 */
async function captureStory(page, root, story, theme, width) {
	await page.goto(
		`http://localhost:6007/iframe.html?id=${story}&viewMode=story&globals=theme:${theme}`,
	);
	await page
		.locator("#storybook-root main, #storybook-root button")
		.first()
		.waitFor();
	if (story.includes("unknown-result")) {
		await page.getByText("結果不明", { exact: true }).waitFor();
		const heading = page.getByRole("button", { name: /^遠隔の項目を更新/ });
		if ((await heading.getAttribute("aria-expanded")) === "false") {
			await heading.click();
		}
		await page
			.getByText(/遠隔処理が完了した可能性/)
			.waitFor({ state: "visible" });
	}
	if (story.includes("personality")) {
		await page
			.getByRole("button", { name: "オプション", exact: true })
			.click();
		await page.getByRole("menuitem", { name: "性格設定" }).click();
		await page.getByRole("dialog", { name: "性格設定" }).waitFor();
	}
	await page.evaluate(() => globalThis.document.fonts.ready);
	await page.locator("#storybook-root").evaluate(async (root) => {
		await Promise.all(
			root
				.getAnimations({ subtree: true })
				.map((animation) => animation.finished),
		);
	});
	const layout = await page.evaluate(() => ({
		width: globalThis.innerWidth,
		scrollWidth: globalThis.document.documentElement.scrollWidth,
		theme: globalThis.document.documentElement.dataset.storybookTheme,
		background: globalThis.getComputedStyle(globalThis.document.body)
			.backgroundColor,
		foreground: globalThis.getComputedStyle(globalThis.document.body).color,
	}));
	assert.equal(layout.theme, theme);
	assert.ok(layout.scrollWidth <= layout.width, JSON.stringify(layout));
	await page.screenshot({
		path: `${root}/${story}-${theme}-${width}.png`,
		fullPage: true,
	});
	return { story, ...layout };
}
void main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
