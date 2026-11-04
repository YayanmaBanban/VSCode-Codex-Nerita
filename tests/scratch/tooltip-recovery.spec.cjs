// ダイアログ外の自動スクロールが、内部の説明を閉じないことを検証する。
const {
	test,
	expect,
	deliverStoryResponse,
	waitForStory,
} = require("../support/scratch-test.cjs");

test("ツールチップ: 別領域のスクロールで閉じない @tooltip", async ({
	reviewBrowser,
}, testInfo) => {
	const page = await reviewBrowser.newPage({
		viewport: { width: 420, height: 900 },
	});
	await page.goto(
		"http://localhost:6006/iframe.html?id=chat-tool-cards--large-output&viewMode=story&globals=theme:dark2026",
	);
	await waitForStory(page);
	await page.locator(".tool-heading").click();
	await page.getByRole("button", { name: "詳細出力", exact: true }).click();
	await deliverStoryResponse(page, "出力応答を受信");
	const detail = page.getByRole("region", { name: "詳細出力" });
	await expect(detail).toContainText("先頭の詳細出力");
	const next = detail.getByRole("button", { name: "次の範囲を表示" });
	await next.hover();
	const tooltip = page.getByRole("tooltip");
	await expect(tooltip).toBeVisible();

	// ダイアログ背後の本文から届く通知では、ヘッダーの起点の位置は変わらない。
	await page.locator(".tool-body").dispatchEvent("scroll");
	await expect(tooltip).toBeVisible();
	await page.screenshot({
		path: testInfo.outputPath("unrelated-scroll.png"),
		animations: "disabled",
	});
});
