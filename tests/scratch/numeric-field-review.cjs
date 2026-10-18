// Storybook 起動後に node tests/scratch/numeric-field-review.cjs で実際のマウス操作と背景の塗りつぶしを検証する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

/** 背景を塗りつぶす割合が範囲内での値の位置と一致するか検証し、画像も残す。 */
async function reviewFill(page, input, root, label) {
	for (const [value, fraction] of [
		[1, 0],
		[300, 299 / 599],
		[600, 1],
	]) {
		await input.fill(String(value));
		const track = input.locator("..");
		const width = await track.evaluate((element) => element.clientWidth);
		const fill = await track.locator("[aria-hidden=true]").boundingBox();
		assert.ok(fill && Math.abs(fill.width - width * fraction) < 1);
		await page.screenshot({ path: `${root}/${label}-${value}.png` });
	}
}

/** クリック後の直接入力と範囲外・小数・空欄からの復旧を実入力で確認する。 */
async function reviewTyping(page, input) {
	await input.click();
	await page.keyboard.type("250");
	assert.equal(await input.inputValue(), "250");
	for (const [value, text] of [
		["601", "1〜600秒"],
		["0", "1〜600秒"],
		["1.5", "整数"],
		["", "空欄"],
	]) {
		await input.fill(value);
		assert.match(
			await page.getByRole("alert").textContent(),
			new RegExp(text),
		);
	}
	await input.fill("120");
	assert.equal(await page.getByRole("alert").count(), 0);
}

/** 領域外でもドラッグが続き、上限到達後の反転や終了後の移動が正しく扱われることを確かめる。 */
async function reviewDrag(page, input) {
	const bounds = await input.boundingBox();
	assert.ok(bounds);
	const x = bounds.x + bounds.width / 2;
	const y = bounds.y + bounds.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 80, y + 100, { steps: 10 });
	assert.equal(await input.inputValue(), "160");
	await page.mouse.up();
	await page.mouse.move(x - 100, y);
	assert.equal(await input.inputValue(), "160");
	await input.fill("120");
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.keyboard.down("Shift");
	await page.mouse.move(x + 120, y);
	assert.equal(await input.inputValue(), "600");
	await page.keyboard.up("Shift");
	await page.mouse.move(x + 118, y);
	assert.equal(await input.inputValue(), "599");
	await page.mouse.up();
	await input.fill("2");
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x - 100, y);
	await page.mouse.up();
	assert.equal(await input.inputValue(), "1");
}

/** 明暗テーマと狭い表示幅で背景の塗りつぶしを撮影し、共通部品の操作と実際のハンドオフ画面のエラー表示を確認する。 */
async function main() {
	const root = `dist/ui-review/numeric-field-${Date.now()}`;
	await fs.mkdir(root, { recursive: true });
	const browser = await chromium.launch();
	const errors = [];
	try {
		const page = await browser.newPage();
		page.on("pageerror", (error) => errors.push(error.message));
		for (const [theme, width] of [
			["dark2026", 1024],
			["light", 420],
		]) {
			await page.setViewportSize({ width, height: 900 });
			await page.goto(
				`http://localhost:6006/iframe.html?id=ui-numeric-field--default&viewMode=story&globals=theme:${theme}`,
			);
			const input = page.getByRole("spinbutton");
			await input.waitFor();
			await reviewFill(page, input, root, theme);
			await reviewTyping(page, input);
			await reviewDrag(page, input);
			await page.goto(
				`http://localhost:6006/iframe.html?id=agent-manager-states--handoff-timeout-out-of-range&viewMode=story&globals=theme:${theme}`,
			);
			await page.getByRole("alert").waitFor();
			await page.getByRole("spinbutton").scrollIntoViewIfNeeded();
			await page.screenshot({
				path: `${root}/${theme}-handoff-error.png`,
				animations: "disabled",
			});
		}
		assert.deepEqual(errors, []);
		await fs.writeFile(`${root}/errors.json`, JSON.stringify(errors));
		console.log(root);
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
