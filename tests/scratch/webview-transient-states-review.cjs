// Storybook 起動後に `node tests/scratch/webview-transient-states-review.cjs` で実行する。
// 製品の表示時間は変えず、仮想時計と WAAPI で一時表示を撮影・検証する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

/** 再生操作の前に時計を停止し、以後の待機時間を正確に進められるようにする。 */
async function open(page, id, theme) {
	await page.clock.resume();
	await page.goto(
		`http://localhost:6006/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`,
	);
	await page.locator("#storybook-root").waitFor();
	await page.clock.pauseAt(
		new Date(await page.evaluate(() => Date.now() + 1)),
	);
}

/** 通知を再生し、表示時間の境界と明示的に閉じる操作を確認する。 */
async function notification(page, directory, theme) {
	await open(page, "chat-notificationcard--default", theme);
	await page
		.getByRole("button", { name: "通知を再生" })
		.evaluate((element) => element.click());
	const notice = page.getByRole("status");
	await notice.waitFor();
	for (const time of [0, 400, 1000, 1600, 1999]) {
		await page
			.locator(".notification-progress")
			.evaluate((element, time) => {
				for (const animation of element.getAnimations()) {
					animation.pause();
					animation.currentTime = time;
				}
			}, time);
		await page.screenshot({
			path: `${directory}/notification-${theme}-${time}.png`,
		});
	}
	await page.clock.runFor(1999);
	assert.equal(await notice.count(), 1);
	await page.clock.runFor(1);
	assert.equal(await notice.count(), 0);
	await page.screenshot({
		path: `${directory}/notification-${theme}-completed.png`,
	});
	await page
		.getByRole("button", { name: "通知を再生" })
		.evaluate((element) => element.click());
	await notice.waitFor();
	await page
		.getByRole("button", { name: "通知を閉じる" })
		.evaluate((element) => element.click());
	assert.equal(await notice.count(), 0);
}

/** コピー成功・失敗の結果が800 ms で消え、途中の演出も撮影できることを確認する。 */
async function copyFeedback(page, directory, theme, fail) {
	await open(page, "chat-copy-feedback--ready", theme);
	await page.evaluate((fail) => {
		Object.defineProperty(globalThis.navigator.clipboard, "writeText", {
			configurable: true,
			value: () =>
				fail
					? Promise.reject(new Error("fixture failure"))
					: Promise.resolve(),
		});
	}, fail);
	const button = page.getByRole("button", { name: "本文をコピー" });
	await button.evaluate((element) => element.click());
	await page.waitForFunction(
		() => globalThis.document.querySelector("[data-copy-result]") !== null,
	);
	const result = fail ? "error" : "success";
	assert.equal(await button.getAttribute("data-copy-result"), result);
	for (const time of [0, 160, 400, 640, 799]) {
		await button.evaluate((element, time) => {
			for (const animation of element.getAnimations({ subtree: true })) {
				animation.pause();
				animation.currentTime = time;
			}
		}, time);
		await page.screenshot({
			path: `${directory}/copy-${result}-${theme}-${time}.png`,
		});
	}
	await page.clock.runFor(799);
	assert.equal(await button.getAttribute("data-copy-result"), result);
	await page.clock.runFor(1);
	assert.equal(await button.getAttribute("data-copy-result"), null);
	await page.screenshot({
		path: `${directory}/copy-${result}-${theme}-completed.png`,
	});
}

/** 接続成功を示す900 ms の演出を再現し、通常表示へ戻ることを確認する。 */
async function connectionFeedback(page, directory, theme) {
	await open(page, "chat-header--transitions", theme);
	await page
		.getByRole("button", { name: "connecting", exact: true })
		.evaluate((element) => element.click());
	await page
		.getByRole("button", { name: "ready", exact: true })
		.evaluate((element) => element.click());
	await page.locator(".connection-confetti").waitFor();
	await page.screenshot({
		path: `${directory}/connection-${theme}-initial.png`,
	});
	await page.clock.runFor(899);
	assert.equal(await page.locator(".connection-confetti").count(), 1);
	await page.clock.runFor(1);
	assert.equal(await page.locator(".connection-confetti").count(), 0);
	await page.screenshot({
		path: `${directory}/connection-${theme}-completed.png`,
	});
}

/** 各一時表示を明暗テーマで検証し、例外と成果物を保存する。 */
async function main() {
	const directory = `dist/ui-review/webview-transient-${Date.now()}`;
	await fs.mkdir(directory, { recursive: true });
	const browser = await chromium.launch();
	const errors = [];
	try {
		const page = await browser.newPage({
			viewport: { width: 420, height: 700 },
		});
		page.on("pageerror", (error) => errors.push(String(error)));
		await page.clock.install();
		for (const theme of ["dark2026", "light"]) {
			await notification(page, directory, theme);
			await copyFeedback(page, directory, theme, false);
			await copyFeedback(page, directory, theme, true);
			await connectionFeedback(page, directory, theme);
		}
		assert.deepEqual(errors, []);
		await fs.writeFile(
			`${directory}/results.json`,
			JSON.stringify(
				{
					errors,
					durations: {
						notification: 2000,
						copy: 800,
						connection: 900,
					},
				},
				null,
				2,
			),
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
