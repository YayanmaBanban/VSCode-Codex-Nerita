// ヘッダーの省略表示・操作・接続演出を実コンポーネントで検証する。
import { test, expect, type Page } from "@playwright/test";
const errors = new Map<Page, string[]>();
test.beforeEach(({ page }) => {
	const messages: string[] = [];
	errors.set(page, messages);
	page.on("pageerror", (error) => messages.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			messages.push(message.text());
		}
	});
});
test.afterEach(({ page }) => {
	expect(errors.get(page)).toEqual([]);
	errors.delete(page);
});
for (const colorScheme of ["dark", "light"] as const) {
	test(`長いタイトル・320px・ツールチップ: ${colorScheme}`, async ({
		page,
	}, info) => {
		await page.setViewportSize({ width: 320, height: 760 });
		await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
		await page.goto(
			"/iframe.html?id=chat-header--long-title&viewMode=story",
		);
		const title = page.locator(".chat-header h1");
		await expect(title).toHaveCSS("font-size", "12px");
		expect(
			await title.evaluate((node) => node.scrollWidth > node.clientWidth),
		).toBe(true);
		await expect(page.locator(".connection-bar, .eyebrow")).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "オプション（準備中）" }),
		).toBeDisabled();
		const button = page.getByRole("button", { name: "新しいチャット" });
		const newChatBox = await button.boundingBox();
		const sessionsBox = await page
			.getByRole("button", { name: "セッション一覧" })
			.boundingBox();
		expect(newChatBox!.x + newChatBox!.width).toBeLessThanOrEqual(
			sessionsBox!.x,
		);
		await button.focus();
		await expect(page.getByRole("tooltip")).toHaveText("新しいチャット");
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		await info.attach(`header-${colorScheme}`, {
			body: await page.screenshot({
				path: info.outputPath(`header-${colorScheme}.png`),
			}),
			contentType: "image/png",
		});
		await button.click();
		await expect(title).toHaveText("新規チャット");
	});
}
test("表示先操作で下書きとスクロールを保持する", async ({ page }, info) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/iframe.html?id=chat-header--long-title&viewMode=story");
	await page.getByRole("textbox").fill("まだ送信していない下書き");
	await page.locator(".conversation").evaluate((node) => {
		node.scrollTop = 50;
	});
	await page.getByRole("button", { name: "エディタグループへ移動" }).click();
	await expect(
		page.getByRole("button", { name: "サイドバーへ戻る" }),
	).toBeVisible();
	await expect(page.getByRole("textbox")).toHaveText(
		"まだ送信していない下書き",
	);
	await expect
		.poll(() =>
			page.locator(".conversation").evaluate((node) => node.scrollTop),
		)
		.toBe(50);
	await page.getByRole("button", { name: "サイドバーへ戻る" }).click();
	await expect(
		page.getByRole("button", { name: "エディタグループへ移動" }),
	).toBeVisible();
	await expect(page.getByRole("textbox")).toHaveText(
		"まだ送信していない下書き",
	);
	await info.attach("view-return", {
		body: await page.screenshot(),
		contentType: "image/png",
	});
});
test("再接続の境界線と接続成功の紙吹雪", async ({ page }, info) => {
	await page.clock.install();
	await page.goto("/iframe.html?id=chat-header--reconnect&viewMode=story");
	await expect(page.locator(".connection-beam")).toBeVisible();
	const beam = page.locator(".connection-beam > div > div");
	await expect(beam).toHaveCSS("background-image", /linear-gradient/);
	await expect(page.locator(".connection-beam > div")).toHaveCSS(
		"border-top-style",
		"solid",
	);
	await page.clock.runFor(750);
	await info.attach("reconnect-initial", {
		body: await page.screenshot({
			path: info.outputPath("reconnect-initial.png"),
		}),
		contentType: "image/png",
	});
	await page.getByRole("button", { name: "接続エラー：再接続" }).click();
	await expect(page.locator(".connection-beam")).toHaveCount(0);
	await expect(page.locator(".confetti-piece")).toHaveCount(12);
	// CSSアニメーションの時刻を直接固定し、タイマー経過とは分けて撮影する。
	for (const [label, time] of [
		["initial", 0],
		["early", 100],
		["middle", 450],
		["late", 800],
		["completed", 900],
	] as const) {
		await page
			.locator(".confetti-piece")
			.evaluateAll((nodes, currentTime) => {
				for (const node of nodes) {
					for (const animation of node.getAnimations()) {
						animation.pause();
						animation.currentTime = currentTime;
					}
				}
			}, time);
		await info.attach(`confetti-${label}-${time}ms`, {
			body: await page.screenshot({
				path: info.outputPath(`confetti-${label}.png`),
			}),
			contentType: "image/png",
		});
	}
	await page.clock.runFor(1000);
	await expect(page.locator(".connection-confetti")).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "接続済み", exact: true }),
	).toBeDisabled();
});
test("動きを減らす設定では接続演出を抑止する", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/iframe.html?id=chat-header--reconnect&viewMode=story");
	await expect(
		page.getByRole("button", { name: "接続エラー：再接続" }),
	).toBeEnabled();
	await expect(page.locator(".connection-beam")).toHaveCount(0);
	await page.getByRole("button", { name: "接続エラー：再接続" }).click();
	await expect(
		page.getByRole("button", { name: "接続済み", exact: true }),
	).toBeVisible();
	await expect(page.locator(".connection-confetti")).toHaveCount(0);
});
