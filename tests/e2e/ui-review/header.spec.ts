// ヘッダーの省略表示・操作・接続演出を実コンポーネントで検証する。
import { expectSent, emitHost, showState } from "../storyBridge";
import { test, expect, type Page } from "@playwright/test";
import { codexConnectionText } from "@nerita/shared/codexConnection";
const errors = new Map<Page, string[]>();

test("認証失敗の通知を閉じ、再試行時に再表示する", async ({ page }, info) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto(
		"/iframe.html?id=chat-header--authentication-failure&viewMode=story",
	);
	const login = page.getByRole("button", {
		name: codexConnectionText.chatgpt,
		exact: true,
	});
	const notice = page
		.getByRole("status")
		.filter({ hasText: codexConnectionText.authenticationFailed });
	await login.click();
	await expect(
		page.getByRole("heading", { name: "認証を待っています" }),
	).toBeVisible();
	await expect(notice).toBeVisible();
	await expect(page.locator(".error-banner")).toHaveCount(0);
	await expect(login).toBeEnabled();
	await info.attach("authentication-failure", {
		body: await page.screenshot({
			path: info.outputPath("authentication-failure.png"),
		}),
		contentType: "image/png",
	});
	await page.getByRole("button", { name: "通知を閉じる" }).click();
	await expect(notice).toHaveCount(0);
	await login.click();
	await expect(notice).toBeVisible();
	await expect(notice).toHaveCount(0, { timeout: 10000 });
	await login.click();
	await expect(notice).toBeVisible();
});

test("認証成功は待機を経て接続済みへ進む", async ({ page }, info) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto(
		"/iframe.html?id=chat-header--authentication-success&viewMode=story",
	);
	await page
		.getByRole("button", { name: codexConnectionText.chatgpt, exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: "認証を待っています" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "接続済み", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("region", { name: "認証", exact: true }),
	).toHaveCount(0);
	await info.attach("authentication-success", {
		body: await page.screenshot({
			path: info.outputPath("authentication-success.png"),
		}),
		contentType: "image/png",
	});
});

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
		await expect(title).toBeVisible();
		expect(
			await title.evaluate((node) => node.scrollWidth > node.clientWidth),
		).toBe(true);
		await expect(
			page.getByRole("button", { name: "オプション" }),
		).toBeEnabled();
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
		await expectSent(page, { type: "session/new" });
		await showState(page, { sessionTitle: "", messages: [], run: "idle" });
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
	await expectSent(page, { type: "ui/openEditor" });
	await emitHost(page, {
		type: "ui/viewState",
		editor: true,
		draft: "まだ送信していない下書き",
		scrollTop: 50,
		restoreScroll: true,
	});
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
	await expectSent(page, { type: "ui/openSidebar" });
	await emitHost(page, {
		type: "ui/viewState",
		editor: false,
		draft: "まだ送信していない下書き",
		scrollTop: 50,
		restoreScroll: true,
	});
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
	await page.clock.runFor(750);
	await info.attach("reconnect-initial", {
		body: await page.screenshot({
			path: info.outputPath("reconnect-initial.png"),
		}),
		contentType: "image/png",
	});
	await page
		.getByRole("button", {
			name: "接続エラー：アカウントを再認証して接続します",
		})
		.click();
	await expect(
		page.getByRole("button", { name: "接続中", exact: true }),
	).toBeVisible();
	await page.clock.runFor(450);
	await expect(page.locator(".connection-beam")).toHaveCount(0);
	await expect(page.locator(".connection-confetti")).toBeVisible();
	// CSS アニメーションの時刻を直接固定し、タイマー経過とは分けて撮影する。
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
test("動きを減らす設定では接続演出を抑止する", async ({ page }, info) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/iframe.html?id=chat-header--reconnect&viewMode=story");
	await expect(
		page.getByRole("button", {
			name: "接続エラー：アカウントを再認証して接続します",
		}),
	).toBeEnabled();
	await expect(page.locator(".connection-beam")).toHaveCount(0);
	await page.locator(".connection-button").hover();
	await info.attach("connection-hover", {
		body: await page.screenshot({
			path: info.outputPath("connection-hover.png"),
		}),
		contentType: "image/png",
	});
	await page
		.getByRole("button", {
			name: "接続エラー：アカウントを再認証して接続します",
		})
		.click();
	await expect(
		page.getByRole("button", { name: "接続済み", exact: true }),
	).toBeVisible();
	await expect(page.locator(".connection-confetti")).toHaveCount(0);
});

test("接続カーテンと待機中の境界線・エラーの案内", async ({ page }, info) => {
	await page.goto("/iframe.html?id=chat-header--transitions&viewMode=story");
	const button = page.locator(".connection-button");
	// 新しく現れる段階も停止し、撮影中に次の段階へ進むのを防ぐ。
	await page.addStyleTag({
		content:
			".connection-curtain, .connection-button { animation-play-state: paused !important; }",
	});
	let previousLabel = "未接続";
	for (const state of ["connecting", "authenticating", "error"] as const) {
		const nextLabel = {
			connecting: "接続中",
			authenticating: "ログイン待ち",
			error: "接続エラー",
		}[state];
		await page.getByRole("button", { name: state, exact: true }).click();
		for (const [phase, times] of [
			["cover", [0, 110, 219]],
			["reveal", [0, 110, 219]],
		] as const) {
			const curtain = page.locator(
				`.connection-curtain[data-phase="${phase}"]`,
			);
			await expect(curtain).toBeAttached();
			await expect(button.getByRole("status")).toHaveText(
				phase === "cover" ? previousLabel : nextLabel,
			);
			for (const time of times) {
				await curtain.evaluate((node, currentTime) => {
					for (const animation of node.getAnimations()) {
						animation.pause();
						animation.currentTime = currentTime;
					}
				}, time);
				await info.attach(`${state}-${phase}-${time}ms`, {
					body: await page.screenshot({
						path: info.outputPath(`${state}-${phase}-${time}.png`),
					}),
					contentType: "image/png",
				});
			}
			await curtain.evaluate((node) => {
				for (const animation of node.getAnimations()) {
					animation.finish();
				}
			});
		}
		await expect(page.locator(".connection-curtain")).toHaveCount(0);
		await expect(button.getByRole("status")).toHaveText(nextLabel);
		previousLabel = nextLabel;
		if (state !== "error") {
			await expect(page.locator(".connection-beam")).toBeVisible();
			await expect(button).toBeDisabled();
		} else {
			await expect(button).toHaveAccessibleName(/接続エラー.*再認証/);
			for (const time of [0, 72, 180, 288, 360]) {
				await button.evaluate((node, currentTime) => {
					for (const animation of node.getAnimations()) {
						animation.pause();
						animation.currentTime = currentTime;
					}
				}, time);
				await info.attach(`shake-${time}ms`, {
					body: await page.screenshot({
						path: info.outputPath(`shake-${time}.png`),
					}),
					contentType: "image/png",
				});
			}
		}
	}
	await page.getByRole("button", { name: "connecting", exact: true }).click();
	await page.getByRole("button", { name: "ready", exact: true }).click();
	await expect(page.locator(".connection-curtain")).toHaveAttribute(
		"data-target",
		"ready",
	);
	for (const phase of ["cover", "reveal"]) {
		await page
			.locator(`.connection-curtain[data-phase="${phase}"]`)
			.evaluate((node) => {
				for (const animation of node.getAnimations()) {
					animation.finish();
				}
			});
	}
	await expect(button.getByRole("status")).toHaveText("接続済み");
	await expect(page.locator(".connection-curtain")).toHaveCount(0);
});
