// 実行: pnpm test:scratch tooltip-scroll-race.spec.cjs --grep "ケース名"
// 仮想時計を使い、100ms の表示待ち前後を固定して再現する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { test } = require("../support/scratch-test.cjs");

/** 一覧の実際の位置を動かし、スクロール通知と表示タイマーを進める。 */
async function scrollTo(page, list, position) {
	await list.evaluate((element, position) => {
		element.scrollTop = position;
		element.dispatchEvent(new Event("scroll"));
	}, position);
	await page.clock.runFor(300);
}

/** ホバーが変わったことを実際のポインターで伝え、表示開始前の時刻を作る。 */
async function hoverFirst(page) {
	await page
		.getByRole("heading", { name: "Agent Manager - Pi", exact: true })
		.hover();
	await page.getByRole("button", { name: "agent-001", exact: true }).hover();
}

/** フッターの表示中だけ一覧が縮み、保存後の退場が終わると残り高さへ戻る。 */
async function checkFooter(page, list, directory) {
	await page
		.getByRole("textbox", { name: "名前", exact: true })
		.fill("agent-001 edited");
	await page.clock.runFor(350);
	const footer = page.locator("footer[data-phase=shown]");
	await page.screenshot({
		path: `${directory}/footer-shown.png`,
		animations: "disabled",
	});
	const footerBounds = await footer.boundingBox();
	const listBounds = await list.boundingBox();
	assert.ok(footerBounds && listBounds);
	assert.ok(
		Math.abs(footerBounds.y - listBounds.y - listBounds.height - 16) < 2,
		"フッター表示時は一覧がその上に収まる",
	);
	await page.getByRole("button", { name: "変更を保存", exact: true }).click();
	await page.clock.runFor(500);
	assert.equal(await page.locator("footer[data-phase=shown]").count(), 1);
	await page.clock.runFor(2300);
	await page.screenshot({
		path: `${directory}/footer-hidden.png`,
		animations: "disabled",
	});
	assert.equal(await page.locator("footer[data-phase=hidden]").count(), 1);
	const restored = await list.boundingBox();
	assert.ok(restored);
	assert.ok(
		Math.abs(900 - restored.y - restored.height - 16) < 2,
		"フッターが非表示になると一覧が画面下まで戻る",
	);
}
/** 各競合条件を初期の一覧から開始し、時刻もケース内で制御する。 */
async function prepare(page) {
	await page.goto(
		"http://localhost:6006/iframe.html?id=agent-manager-states--many-pi-agents&viewMode=story&globals=theme:dark2026",
	);
	await page.getByRole("textbox", { name: "名前", exact: true }).waitFor();
	await page.getByRole("searchbox").click();
	await page.clock.install();
	await page.clock.pauseAt(
		new Date(await page.evaluate(() => Date.now() + 50)),
	);
	return page.getByRole("region", { name: "エージェント一覧" });
}
for (const state of ["pending", "visible"]) {
	test(`ツールチップ: ${state} のスクロールで閉じる @behavior`, async ({
		reviewBrowser: browser,
	}, testInfo) => {
		const page = await browser.newPage({
			viewport: { width: 1024, height: 760 },
		});
		const list = await prepare(page);
		await scrollTo(page, list, 0);
		await hoverFirst(page);
		await page.clock.runFor(state === "pending" ? 50 : 150);
		if (state === "visible") {
			assert.equal(
				await page.getByRole("tooltip").count(),
				1,
				"新しいホバーでは再表示できる",
			);
		}
		await scrollTo(page, list, 100000);
		assert.equal(
			await page.getByRole("tooltip").count(),
			0,
			state === "pending"
				? "表示待ちの後にスクロールしても再表示しない"
				: "表示済みの説明もスクロール時に閉じる",
		);
		await page.screenshot({
			path: testInfo.outputPath(`${state}-scroll.png`),
		});
		if (state === "pending") {
			await scrollTo(page, list, 0);
			await hoverFirst(page);
			await page.clock.runFor(150);
			assert.equal(
				await page.getByRole("tooltip").count(),
				1,
				"新しいホバーでは再表示できる",
			);
		}
	});
}
test("エージェント一覧: 高さとリサイズ後のフッター @layout @behavior", async ({
	reviewBrowser: browser,
}, testInfo) => {
	const directory = testInfo.outputPath("review");
	await fs.mkdir(directory, { recursive: true });
	const page = await browser.newPage({
		viewport: { width: 1024, height: 760 },
	});
	const list = await prepare(page);
	await scrollTo(page, list, 100000);
	const bounds = await list.boundingBox();
	assert.ok(bounds);
	assert.ok(
		Math.abs(760 - bounds.y - bounds.height - 16) < 2,
		"一覧が画面下端の余白まで埋まる",
	);
	await page.setViewportSize({ width: 1024, height: 900 });
	await page.clock.runFor(50);
	const resized = await list.boundingBox();
	assert.ok(resized);
	assert.ok(
		Math.abs(900 - resized.y - resized.height - 16) < 2,
		"画面サイズの変更にも追従する",
	);
	await checkFooter(page, list, directory);
	await fs.writeFile(
		`${directory}/results.json`,
		JSON.stringify({ bounds, resized }, null, 2),
	);
});
