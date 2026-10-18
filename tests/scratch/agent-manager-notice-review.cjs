// Storybook 起動後に node tests/scratch/agent-manager-notice-review.cjs で実行する。
// 選択表示の退場時刻を固定し、明暗・狭幅でスクロール後のフッター操作を確認する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

/** 既定値への移動時に退場アニメーションを止め、中間の透明度と完了後の非表示を確認する。 */
async function selection(page) {
	const selected = page.getByRole("region", { name: "選択中のエージェント" });
	await page.screenshot({ animations: "disabled" });
	assert.match(await selected.textContent(), /agent-001/);
	await page
		.getByRole("button", { name: "Workspace defaults", exact: true })
		.click();
	const midpoint = await selected.evaluate((element) => {
		const animations = element.getAnimations();
		if (!animations.length) {
			throw new Error("退場アニメーションがありません。");
		}
		for (const animation of animations) {
			animation.pause();
			animation.currentTime =
				Number(animation.effect.getTiming().duration) / 2;
		}
		return Number(globalThis.getComputedStyle(element).opacity);
	});
	assert.ok(midpoint > 0 && midpoint < 1);
	await selected.evaluate((element) => {
		for (const animation of element.getAnimations()) {
			animation.finish();
		}
	});
	await selected.waitFor({ state: "detached" });
	await page.getByRole("button", { name: "agent-001", exact: true }).click();
	await selected.waitFor();
}

/** スクロール後にも操作が見え、破棄で保留していた項目へ移動することを確認する。 */
async function navigation(page, root, label, width) {
	await page
		.getByRole("textbox", { name: "名前", exact: true })
		.fill("edited-agent");
	await page.getByRole("button", { name: "agent-002", exact: true }).click();
	const footer = page.getByRole("region", { name: "未保存の変更" });
	await footer.waitFor();
	await page.evaluate(() =>
		globalThis.scrollTo(0, globalThis.document.body.scrollHeight),
	);
	await page.screenshot({
		path: `${root}/${label}.png`,
		animations: "disabled",
	});
	assert.match(
		await footer.textContent(),
		/未保存の変更を破棄して移動しますか？/,
	);
	assert.equal(await footer.getByRole("button").count(), 2);
	const bounds = await footer.boundingBox();
	assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 950);
	assert.ok(
		await page.evaluate(
			() =>
				globalThis.document.documentElement.scrollWidth <=
				globalThis.innerWidth,
		),
	);
	if (width >= 640) {
		const list = await page
			.getByRole("region", { name: "エージェント一覧" })
			.boundingBox();
		assert.ok(list && list.y + list.height <= bounds.y);
	}
	const discard = footer.getByRole("button", {
		name: "変更を破棄",
		exact: true,
	});
	assert.equal(await discard.locator(".bg-yellow-300").count(), 1);
	await discard.click();
	assert.equal(
		await page
			.getByRole("textbox", { name: "名前", exact: true })
			.inputValue(),
		"agent-002",
	);
}

/** 明暗テーマと狭い表示幅で未保存確認を撮影し、ブラウザーエラーを確認する。 */
async function main() {
	const root = `dist/ui-review/agent-manager-navigation-${Date.now()}`;
	await fs.mkdir(root, { recursive: true });
	const browser = await chromium.launch();
	const errors = [];
	try {
		const page = await browser.newPage();
		page.on("pageerror", (error) => errors.push(String(error)));
		for (const [theme, width] of [
			["dark2026", 1100],
			["light", 420],
		]) {
			await page.setViewportSize({ width, height: 950 });
			await page.goto(
				`http://localhost:6006/iframe.html?id=agent-manager-states--many-pi-agents&viewMode=story&globals=theme:${
					theme
				}`,
			);
			await page
				.getByRole("textbox", { name: "名前", exact: true })
				.waitFor();
			await selection(page);
			await navigation(page, root, `${theme}-${width}`, width);
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
