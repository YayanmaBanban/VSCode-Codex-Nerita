// 履歴ペインの取得表示・各操作・明暗テーマと狭い幅を実画面で確認する。
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

test("次ページの取得と名前変更の取消", async ({ page }, info) => {
	await page.goto("/iframe.html?id=chat-sessions--paginated&viewMode=story");
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
	await page.goto("/iframe.html?id=chat-sessions--history&viewMode=story");
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
	await expect(row).toHaveCSS("filter", "brightness(1.1)");
	await page.screenshot({ path: info.outputPath("hover.png") });
	await row.getByRole("button", { name: /名前を変更/ }).click();
	await row
		.getByRole("textbox", { name: "新しいセッション名" })
		.fill("名前を変更した会話");
	await page.screenshot({ path: info.outputPath("rename.png") });
	await row.getByRole("button", { name: "保存", exact: true }).click();
	await page.clock.runFor(800);
	await expect(
		row.getByRole("button", { name: "名前を変更した会話を開く" }),
	).toBeVisible();
	await expect(page.getByRole("log")).toBeEmpty();
	await row.getByRole("button", { name: /を開く$/ }).click();
	await expect(page.getByRole("log")).toContainText(
		"保存された会話を読み込みました。",
	);
	await row.getByRole("button", { name: /をフォーク$/ }).click();
	await page.clock.runFor(800);
	await expect(panel.getByRole("listitem")).toHaveCount(4);
	await expect(
		panel.getByRole("button", { name: /（フォーク）を開く/ }),
	).toHaveAttribute("aria-current", "true");
	await panel
		.getByRole("listitem")
		.nth(1)
		.getByRole("button", { name: /をアーカイブ$/ })
		.click();
	await page.clock.runFor(800);
	await expect(panel.getByRole("listitem")).toHaveCount(3);
	await panel
		.getByRole("button", { name: "アーカイブ済み", exact: true })
		.click();
	await page.clock.runFor(800);
	await expect(panel.getByRole("listitem")).toHaveCount(1);
	await expect(panel.getByRole("button", { name: /を開く$/ })).toBeDisabled();
	await page.screenshot({ path: info.outputPath("archived.png") });
	await panel.getByRole("button", { name: /をアーカイブから戻す$/ }).click();
	await page.clock.runFor(800);
	await expect(panel.getByRole("listitem")).toHaveCount(0);
	await panel
		.getByRole("button", { name: "通常の履歴", exact: true })
		.click();
	await page.clock.runFor(800);
	await expect(panel.getByRole("listitem")).toHaveCount(4);
	await page.getByRole("button", { name: "＋ 新規会話" }).click();
	await expect(panel.getByRole("progressbar")).toBeVisible();
	await page.clock.runFor(800);
	await expect(
		panel.getByRole("button", { name: "新しいセッションを開く" }),
	).toBeVisible();
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
			await page.goto(
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
		await page.goto(
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
