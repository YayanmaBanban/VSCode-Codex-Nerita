// Storybook 起動後に `node tests/scratch/agent-manager-controls-review.cjs before|after` で実行する。
// 明暗・表示幅ごとに入力欄とヘッダーボタンを撮影し、変更後の操作と適用スタイルを確認する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

/** 製品コンポーネントの表示を、同じストーリーと条件で比較する。 */
async function main() {
	const phase = process.argv[2] ?? "after";
	const root = `dist/ui-review/agent-manager-controls-${phase}-${Date.now()}`;
	await fs.mkdir(root, { recursive: true });
	const browser = await chromium.launch();
	const errors = [];
	const results = [];
	try {
		const page = await browser.newPage();
		page.on("pageerror", (error) => errors.push(String(error)));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		for (const [theme, width] of [
			["dark2026", 420],
			["dark2026", 1100],
			["light", 420],
			["light", 1100],
		]) {
			await page.setViewportSize({ width, height: 950 });
			await page.goto(
				`http://localhost:6006/iframe.html?id=agent-manager--codex&viewMode=story&globals=theme:${theme}`,
			);
			await page
				.getByRole("textbox", { name: "名前", exact: true })
				.waitFor();
			const label = `${theme}-${width}`;
			await page.screenshot({
				path: `${root}/${label}.png`,
				fullPage: true,
			});
			if (phase === "after") {
				results.push(await reviewControls(page, root, label));
			}
		}
		await fs.writeFile(
			`${root}/results.json`,
			JSON.stringify({ errors, results }, null, 2),
		);
		assert.deepEqual(errors, []);
		console.log(root);
	} finally {
		await browser.close();
	}
}

/** ホバー・フォーカス・追加操作と、長い入力によるサイズ変化を確認する。 */
async function reviewControls(page, root, label) {
	await page.getByRole("button", { name: "再読み込み", exact: true }).click();
	await page.getByRole("textbox", { name: "名前", exact: true }).waitFor();
	const styles = [];
	for (const name of ["再読み込み", "新しいエージェントを追加"]) {
		const button = page.getByRole("button", { name, exact: true });
		await page.mouse.move(0, 0);
		const normal = await button.evaluate((element) => {
			const style = globalThis.getComputedStyle(element);
			return {
				border: style.borderTopWidth,
				background: style.backgroundColor,
			};
		});
		assert.equal(normal.border, "0px");
		assert.equal(normal.background, "rgba(0, 0, 0, 0)");
		const icon = await button.locator("svg").boundingBox();
		assert.equal(icon.width, 16);
		assert.equal(icon.height, 16);
		await button.hover();
		const tooltip = page.getByRole("tooltip", { name, exact: true });
		await tooltip.waitFor();
		await tooltip.evaluate(async (element) => {
			await Promise.all(
				element.getAnimations().map((animation) => animation.finished),
			);
		});
		const hover = await button.evaluate(
			(element) => globalThis.getComputedStyle(element).backgroundColor,
		);
		assert.notEqual(hover, normal.background);
		await page.screenshot({
			path: `${root}/${label}-${name}.png`,
			fullPage: true,
		});
		styles.push({ name, normal, hover });
		await page.keyboard.press("Escape");
	}
	const add = page.getByRole("button", {
		name: "新しいエージェントを追加",
		exact: true,
	});
	assert.equal(await add.locator("svg.lucide-user-plus").count(), 1);
	await add.focus();
	await page.keyboard.press("Enter");
	await page.getByRole("textbox", { name: "ファイル名" }).waitFor();
	assert.equal(await add.isDisabled(), true);
	const sizes = [];
	for (const name of ["説明", "システムプロンプト"]) {
		const field = page.getByRole("textbox", { name, exact: true });
		const before = await field.boundingBox();
		assert.equal(
			await field.evaluate(
				(element) => globalThis.getComputedStyle(element).resize,
			),
			"none",
		);
		await field.fill("日本語の長い入力内容\n".repeat(100));
		const after = await field.boundingBox();
		assert.equal(after.height, before.height);
		assert.equal(after.width, before.width);
		sizes.push({ name, before, after });
	}
	await page.screenshot({ path: `${root}/${label}-new.png`, fullPage: true });
	const layout = await page.evaluate(() => ({
		width: globalThis.innerWidth,
		scrollWidth: globalThis.document.documentElement.scrollWidth,
		theme: globalThis.document.documentElement.dataset.storybookTheme,
	}));
	assert.ok(layout.scrollWidth <= layout.width);
	return { label, styles, sizes, layout };
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
