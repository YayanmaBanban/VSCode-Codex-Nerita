// 実行: pnpm test:scratch numeric-field-review.spec.cjs --grep "ケース名"
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { test } = require("../support/scratch-test.cjs");

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

for (const [name, review] of [
	["値に応じた塗りつぶし", reviewFill],
	["入力エラーから復旧する", reviewTyping],
	["ドラッグの範囲と終了", reviewDrag],
]) {
	test(`数値フィールド: ${name} @behavior`, async ({
		reviewBrowser: browser,
	}, testInfo) => {
		const root = testInfo.outputPath("review");
		await fs.mkdir(root, { recursive: true });
		const page = await browser.newPage({
			viewport: { width: 1024, height: 900 },
		});
		await page.goto(
			"http://localhost:6006/iframe.html?id=ui-numeric-field--default&viewMode=story&globals=theme:dark2026",
		);
		const input = page.getByRole("spinbutton");
		await input.waitFor();
		// ドラッグの期待値は、元の入力検証が最後に設定した120を前提とする。
		await input.fill("120");
		await review(page, input, root, "dark2026");
	});
}
for (const [theme, width] of [
	["dark2026", 1024],
	["light", 420],
]) {
	test(`ハンドオフ: 範囲外の数値を表示する ${theme} ${width} @visual`, async ({
		reviewBrowser: browser,
	}, testInfo) => {
		const page = await browser.newPage({
			viewport: { width, height: 900 },
		});
		await page.goto(
			`http://localhost:6006/iframe.html?id=agent-manager-states--handoff-timeout-out-of-range&viewMode=story&globals=theme:${theme}`,
		);
		await page.getByRole("alert").waitFor();
		await page.getByRole("spinbutton").scrollIntoViewIfNeeded();
		await page.screenshot({
			path: testInfo.outputPath("handoff-error.png"),
			animations: "disabled",
		});
	});
}
