// 入力保持・ロック・受付通知と残り時間の表示を実際のブラウザーで確認する。
import { test, expect } from "@playwright/test";

for (const colorScheme of ["dark", "light"] as const) {
	test(`フォローアップ失敗・ロック解除・再送: ${colorScheme}`, async ({
		page,
	}, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 820 });
		await page.emulateMedia({ colorScheme });
		await page.clock.install();
		await page.goto(
			"/iframe.html?id=chat-followup--failure&viewMode=story",
		);
		await expect(
			page.getByText("フォローアップを送信", { exact: true }),
		).toBeVisible();
		const input = page.locator(".composer-content");
		await input.fill("追加の指示を保持してください");
		await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
		await page
			.getByRole("button", { name: "フォローアップを送信" })
			.click();
		await expect(input).toHaveAttribute("contenteditable", "false");
		await page.clock.runFor(200);
		await expect(input).toHaveAttribute("contenteditable", "false");
		await expect(input).toHaveText("追加の指示を保持してください");
		await info.attach("locked", {
			body: await page.screenshot(),
			contentType: "image/png",
		});
		await page.clock.runFor(300);
		await expect(input).toHaveAttribute("contenteditable", "true");
		await expect(input).toHaveText("追加の指示を保持してください");
		await expect(page.locator(".notification-card")).toContainText(
			"送信できませんでした",
		);
		await expect(page.getByRole("alert")).toHaveCount(0);
		await info.attach("failure", {
			body: await page.screenshot({
				path: info.outputPath("failure.png"),
			}),
			contentType: "image/png",
		});
		await page.getByRole("button", { name: "通知を閉じる" }).click();
		await expect(page.locator(".notification-card")).toHaveCount(0);
		await input.press("Control+Enter");
		await page.clock.runFor(500);
		await expect(input).toBeEmpty();
		await expect(input).toHaveAttribute("contenteditable", "true");
		await expect(page.locator(".notification-card")).toHaveCount(0);
		await info.attach("accepted", {
			body: await page.screenshot({
				path: info.outputPath("accepted.png"),
			}),
			contentType: "image/png",
		});
		await page.clock.runFor(2000);
		await expect(page.locator(".notification-card")).toHaveCount(0);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		expect(errors).toEqual([]);
	});
}
test("通常送信も失敗時は下書きを保持する", async ({ page }) => {
	await page.goto(
		"/iframe.html?id=chat-followup--normal-failure&viewMode=story",
	);
	const input = page.getByRole("textbox");
	await input.fill("通常の送信も保持");
	await input.press("Control+Enter");
	await expect(page.locator(".notification-card")).toContainText(
		"送信できませんでした",
	);
	await expect(input).toHaveText("通常の送信も保持");
	await expect(input).toHaveAttribute("contenteditable", "true");
});
test("通知バーの初期・途中・終了と背景色", async ({ page }, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.clock.install();
	await page.goto(
		"/iframe.html?id=chat-notificationcard--custom-background&viewMode=story",
	);
	await expect(page.locator(".notification-card")).toBeVisible();
	await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
	await expect(page.locator(".notification-card")).toHaveCSS(
		"background-color",
		"rgb(40, 72, 58)",
	);
	const bar = page.locator(".notification-progress");
	await expect
		.poll(() => bar.evaluate((element) => element.getAnimations().length))
		.toBeGreaterThan(0);
	// WAAPIの時刻を直接指定し、スクリーンショットの待ち時間に左右されない。
	for (const [name, time] of [
		["initial", 0],
		["early", 200],
		["middle", 1000],
		["late", 1800],
		["completed", 2000],
	] as const) {
		await bar.evaluate((element, time) => {
			for (const animation of element.getAnimations()) {
				animation.pause();
				animation.currentTime = time;
			}
		}, time);
		const scale = await bar.evaluate(
			(element) => new DOMMatrix(getComputedStyle(element).transform).a,
		);
		expect(scale).toBeCloseTo(1 - time / 2000, 2);
		await info.attach(`${name}-${time}ms`, {
			body: await page.screenshot(),
			contentType: "image/png",
		});
	}
	await page.clock.runFor(2000);
	await expect(page.locator(".notification-card")).toHaveCount(0);
	await info.attach("dismissed", {
		body: await page.screenshot(),
		contentType: "image/png",
	});
	expect(errors).toEqual([]);
});
