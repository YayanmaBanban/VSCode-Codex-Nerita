// 共通 fixture が、同じケース内で作るページの保存状態も分離することを検証する。
const { test, expect } = require("../support/scratch-test.cjs");

test("検証環境: ページ間で保存状態を共有しない @runner", async ({
	reviewBrowser,
}) => {
	const first = await reviewBrowser.newPage();
	const second = await reviewBrowser.newPage();
	for (const page of [first, second]) {
		await page.route("http://scratch.test/**", (route) =>
			route.fulfill({
				body: "<main>fixture</main>",
				contentType: "text/html",
			}),
		);
		await page.goto("http://scratch.test/");
	}
	await first.evaluate(() =>
		globalThis.localStorage.setItem("scratch-state", "first"),
	);
	expect(
		await second.evaluate(() =>
			globalThis.localStorage.getItem("scratch-state"),
		),
	).toBeNull();
	await first.close();
	expect(await second.locator("main").textContent()).toBe("fixture");
});
