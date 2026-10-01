// 履歴ペインの取得表示・各操作・明暗テーマと狭い幅を実画面で確認する。
import { openStory } from "../storyPage";
import { expectSent, showState } from "../storyBridge";
import { sessionRows } from "../../../apps/nerita-ui/stories/chat/fixtures/sessions";
import { expect, test, type Page } from "@playwright/test";
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

for (const theme of ["dark", "light"] as const) {
	test(`削除確認・取消・履歴とアーカイブからの削除: ${theme}`, async ({
		page,
	}, info) => {
		await page.setViewportSize({ width: 320, height: 820 });
		await page.emulateMedia({ colorScheme: theme });
		await openStory(
			page,
			"/iframe.html?id=chat-sessions--history&viewMode=story",
		);
		await page
			.getByRole("button", { name: "セッション一覧", exact: true })
			.click();
		const panel = page.getByRole("complementary", {
			name: "セッション一覧",
		});
		await expect(panel.getByRole("listitem")).toHaveCount(3);
		const trigger = panel.getByRole("button", { name: /を削除$/ }).first();
		await trigger.hover();
		await expect(page.getByRole("tooltip")).toHaveText("セッションを削除");
		await expect(page.getByRole("tooltip")).toHaveCSS("opacity", "1");
		await info.attach(`delete-tooltip-${theme}`, {
			body: await page.screenshot({
				path: info.outputPath("delete-tooltip.png"),
			}),
			contentType: "image/png",
		});
		await trigger.click();
		const dialog = page.getByRole("alertdialog");
		await expect(dialog).toContainText("この操作は取り消せません。");
		await expect(
			dialog.getByRole("button", { name: "キャンセル" }),
		).toBeFocused();
		await info.attach(`delete-confirm-${theme}`, {
			body: await page.screenshot({
				path: info.outputPath("delete-confirm.png"),
			}),
			contentType: "image/png",
		});
		await dialog.getByRole("button", { name: "キャンセル" }).click();
		await expect(trigger).toBeFocused();
		await expect(panel.getByRole("listitem")).toHaveCount(3);
		await trigger.click();
		await dialog.press("Escape");
		await expect(dialog).toHaveCount(0);
		await expect(panel).toBeVisible();
		await trigger.click();
		await dialog
			.getByRole("button", { name: "セッションを削除", exact: true })
			.click();
		await expectSent(page, { type: "session/delete", sessionId: "recent" });
		await showState(page, { sessions: sessionRows().slice(1) });
		await expect(panel.getByRole("listitem")).toHaveCount(2);
		await panel
			.getByRole("button", { name: /をアーカイブ$/ })
			.first()
			.click();
		await expectSent(page, { type: "session/archive", sessionId: "older" });
		await showState(page, { sessions: [sessionRows()[2]!] });
		await expect(panel.getByRole("listitem")).toHaveCount(1);
		await panel
			.getByRole("button", { name: "アーカイブ", exact: true })
			.click();
		await expect(
			panel.getByRole("button", { name: /をアーカイブから戻す$/ }),
		).toBeVisible();
		await panel.getByRole("button", { name: /を削除$/ }).click();
		await dialog
			.getByRole("button", { name: "セッションを削除", exact: true })
			.click();
		await expectSent(page, { type: "session/delete" });
		await showState(page, { sessions: [] });
		await expect(panel.getByRole("listitem")).toHaveCount(0);
	});
}

test("次ページの取得と名前変更の取消", async ({ page }, info) => {
	await openStory(
		page,
		"/iframe.html?id=chat-sessions--paginated&viewMode=story",
	);
	await page
		.getByRole("button", { name: "セッション一覧", exact: true })
		.click();
	const panel = page.getByRole("complementary", { name: "セッション一覧" });
	await expect(panel.getByRole("listitem")).toHaveCount(2);
	await panel.getByRole("button", { name: "さらに読み込む" }).click();
	await expect(panel.getByRole("listitem")).toHaveCount(3);
	await expect(
		panel.getByRole("button", { name: "さらに読み込む" }),
	).toHaveCount(0);
	await panel
		.getByRole("button", { name: /名前を変更/ })
		.first()
		.click();
	const input = panel.getByRole("textbox", { name: "新しいセッション名" });
	await input.fill(" ");
	await expect(
		panel.getByRole("button", { name: "保存", exact: true }),
	).toBeDisabled();
	await input.press("Escape");
	await expect(input).toHaveCount(0);
	await expect(panel).toBeVisible();
	await page.screenshot({ path: info.outputPath("pagination.png") });
});

test("取得・再取得・選択・名前ボタン・フォーク・アーカイブ", async ({
	page,
}, info) => {
	await page.clock.install();
	await page.setViewportSize({ width: 1000, height: 820 });
	await openStory(
		page,
		"/iframe.html?id=chat-sessions--history&viewMode=story",
	);
	await page
		.getByRole("button", { name: "セッション一覧", exact: true })
		.click();
	const panel = page.getByRole("complementary", { name: "セッション一覧" });
	await expect(panel.getByRole("progressbar")).toBeVisible();
	await page.screenshot({ path: info.outputPath("loading.png") });
	// CSS 回転を停止して再生時刻を指定し、円形表示の一周期を確認する。
	for (const [phase, time] of [
		["initial", 0],
		["early", 250],
		["middle", 500],
		["late", 750],
		["completed", 1000],
	] as const) {
		await panel
			.getByRole("progressbar")
			.locator("svg")
			.evaluate((element, time) => {
				for (const animation of element.getAnimations()) {
					animation.pause();
					animation.currentTime = time;
				}
			}, time);
		await page.screenshot({
			path: info.outputPath(`spinner-${phase}-${time}ms.png`),
		});
	}
	await page.clock.runFor(800);
	await expect(panel.getByRole("listitem")).toHaveCount(3);
	await expect(panel.getByText("2分前", { exact: true })).toBeVisible();
	await expect(panel.getByText("更新日時不明")).toBeVisible();
	const row = panel.getByRole("listitem").first();
	await row.hover();
	await expect(row.getByRole("button", { name: /名前を変更/ })).toBeVisible();
	await page.screenshot({ path: info.outputPath("hover.png") });
	await row.getByRole("button", { name: /名前を変更/ }).click();
	await row
		.getByRole("textbox", { name: "新しいセッション名" })
		.fill("名前を変更した会話");
	await page.screenshot({ path: info.outputPath("rename.png") });
	await row.getByRole("button", { name: "保存", exact: true }).click();
	await page.clock.runFor(800);
	await expectSent(page, {
		type: "session/rename",
		sessionId: "recent",
		name: "名前を変更した会話",
	});
	await row.getByRole("button", { name: /を開く$/ }).click();
	await expectSent(page, { type: "session/load", sessionId: "recent" });
	await row.getByRole("button", { name: /をフォーク$/ }).click();
	await expectSent(page, { type: "session/fork", sessionId: "recent" });
	await row.getByRole("button", { name: /をアーカイブ$/ }).click();
	await expectSent(page, { type: "session/archive", sessionId: "recent" });
	await panel
		.getByRole("button", { name: "アーカイブ", exact: true })
		.click();
	await page.clock.runFor(800);
	await expect(panel.getByRole("button", { name: /を開く$/ })).toBeDisabled();
	await page.screenshot({ path: info.outputPath("archived.png") });
	await panel.getByRole("button", { name: /をアーカイブから戻す$/ }).click();
	await expectSent(page, { type: "session/unarchive", sessionId: "recent" });
	await page.getByRole("button", { name: "新しいチャット" }).click();
	await expectSent(page, { type: "session/new" });
	await panel.getByRole("button", { name: "セッション一覧を閉じる" }).click();
	const toggle = page.getByRole("button", {
		name: "セッション一覧",
		exact: true,
	});
	await expect(toggle).toBeFocused();
	await toggle.press("Enter");
	await expect(panel.getByRole("progressbar")).toBeVisible();
	await panel
		.getByRole("button", { name: "セッション一覧を閉じる" })
		.press("Escape");
	await expect(panel).toHaveCount(0);
});
for (const colorScheme of ["dark", "light"] as const) {
	for (const width of [320, 1000]) {
		test(`履歴・長いパスとタイトル: ${colorScheme} ${width}`, async ({
			page,
		}, info) => {
			await page.setViewportSize({ width, height: 820 });
			await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
			await openStory(
				page,
				"/iframe.html?id=chat-sessions--history&viewMode=story",
			);
			await page
				.getByRole("button", { name: "セッション一覧", exact: true })
				.click();
			await expect(page.getByRole("listitem")).toHaveCount(3);
			await page.evaluate(() => document.fonts.ready);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await expect(
				page.getByRole("button", {
					name: /長いセッションタイトル.*をフォーク$/,
				}),
			).toBeInViewport();
			await page.screenshot({
				path: info.outputPath(`sessions-${colorScheme}-${width}.png`),
			});
		});
	}
}
for (const scenario of ["empty", "error", "unsupported"]) {
	test(`履歴の状態: ${scenario}`, async ({ page }, info) => {
		await openStory(
			page,
			`/iframe.html?id=chat-sessions--${scenario}&viewMode=story`,
		);
		if (scenario === "unsupported") {
			await expect(
				page.getByRole("button", {
					name: "セッション一覧",
					exact: true,
				}),
			).toBeDisabled();
			await page.screenshot({ path: info.outputPath("unsupported.png") });
			return;
		}
		await page
			.getByRole("button", { name: "セッション一覧", exact: true })
			.click();
		await expect(
			page.getByRole("progressbar", { name: "セッション一覧を取得中" }),
		).toHaveCount(0);
		if (scenario === "empty") {
			await expect(
				page.getByText("このフォルダのセッションはありません"),
			).toBeVisible();
		} else {
			await expect(
				page.getByRole("complementary").getByRole("alert"),
			).toBeVisible();
		}
		await page.screenshot({ path: info.outputPath(`${scenario}.png`) });
	});
}
