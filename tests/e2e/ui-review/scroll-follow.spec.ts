// 本文・ツールの増加中に、手動閲覧の保持と末尾への追従再開を検証する。
import { test, expect } from "@playwright/test";

test("末尾追従・手動スクロール・再開・会話切替", async ({ page }, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	await page.goto(
		"/iframe.html?id=chat-scroll-follow--updates&viewMode=story",
	);
	const conversation = page.getByRole("region", {
		name: "会話",
		exact: true,
	});
	const gap = () =>
		conversation.evaluate(
			(element) =>
				element.scrollHeight - element.clientHeight - element.scrollTop,
		);
	// 初回のStory読み込み時間を、末尾追従の応答時間に含めない。
	await expect(page.getByRole("log", { name: "メッセージ" })).toBeVisible();
	await expect.poll(gap).toBeLessThanOrEqual(4);
	await page.getByRole("button", { name: "本文を追記" }).click();
	await expect.poll(gap).toBeLessThanOrEqual(4);
	await conversation.hover();
	await page.mouse.wheel(0, -600);
	await expect.poll(gap).toBeGreaterThan(100);
	// ホイールの慣性を終えてから、更新前の位置を記録する。
	await expect
		.poll(() => conversation.evaluate((element) => element.scrollTop))
		.toBeGreaterThan(0);
	await conversation.evaluate((element) => {
		element.scrollTop = 100;
	});
	await expect(conversation).toHaveJSProperty("scrollTop", 100);
	await page.getByRole("button", { name: "本文を追記" }).click();
	await expect(page.getByRole("log")).toContainText("追記した本文です。");
	await expect(conversation).toHaveJSProperty("scrollTop", 100);
	await page.getByRole("button", { name: "ツールを追加" }).click();
	await expect(page.locator(".tool-card")).toHaveCount(1);
	await expect(conversation).toHaveJSProperty("scrollTop", 100);
	await conversation.hover();
	await page.mouse.wheel(0, 100000);
	await expect.poll(gap).toBeLessThanOrEqual(4);
	await page.getByRole("button", { name: "本文を追記" }).click();
	await expect.poll(gap).toBeLessThanOrEqual(4);
	await page.getByRole("button", { name: "推論 実行中" }).click();
	await expect.poll(gap).toBeLessThanOrEqual(4);
	await page.getByRole("button", { name: "推論 実行中" }).click();
	await expect.poll(gap).toBeLessThanOrEqual(4);
	await conversation.evaluate((element) => {
		element.scrollTop = 100;
	});
	await expect(conversation).toHaveJSProperty("scrollTop", 100);
	await page.getByRole("button", { name: "会話を切替" }).click();
	await expect.poll(gap).toBeLessThanOrEqual(4);
	await page.setViewportSize({ width: 320, height: 600 });
	await expect.poll(gap).toBeLessThanOrEqual(4);
	await info.attach("following", {
		body: await page.screenshot({ path: info.outputPath("following.png") }),
		contentType: "image/png",
	});
	expect(errors).toEqual([]);
});
