// 実際のチャット Story を操作し、画像・動画・trace とブラウザエラーを保存する。
import { test, expect, type Page } from "@playwright/test";
const pageErrors = new Map<Page, string[]>();
test.beforeEach(({ page }) => {
	const errors: string[] = [];
	pageErrors.set(page, errors);
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
});
test.afterEach(async ({ page }, info) => {
	const errors = pageErrors.get(page) ?? [];
	await info.attach("browser-errors", {
		body: JSON.stringify(errors),
		contentType: "application/json",
	});
	pageErrors.delete(page);
	expect(errors).toEqual([]);
});
test("送信・逐次応答・完了・新規会話", async ({ page }, info) => {
	await page.goto("/iframe.html?id=chat-app--empty&viewMode=story");
	await page.getByRole("textbox").fill("設定を確認してください");
	await page.getByRole("button", { name: "送信" }).click();
	await expect(page.getByRole("button", { name: "停止" })).toBeVisible();
	await expect(page.getByText(/作業が完了しました/)).toBeVisible();
	await info.attach("completed", {
		body: await page.screenshot(),
		contentType: "image/png",
	});
	await page.getByRole("button", { name: "＋ 新規会話" }).click();
	await expect(page.getByText("ここから、一緒に。")).toBeVisible();
});
for (const choice of ["今回のみ許可", "拒否"]) {
	test(`承認要求: ${choice}`, async ({ page }, info) => {
		await page.goto("/iframe.html?id=chat-app--permission&viewMode=story");
		await expect(
			page.getByRole("region", { name: "承認要求" }),
		).toBeVisible();
		await info.attach("permission", {
			body: await page.screenshot(),
			contentType: "image/png",
		});
		await page.getByRole("button", { name: choice, exact: true }).click();
		await expect(
			page.getByRole("region", { name: "承認要求" }),
		).toHaveCount(0);
		await expect(
			page.locator(
				`.tool-card[data-status="${choice === "拒否" ? "failed" : "completed"}"]`,
			),
		).toBeVisible();
		await expect(page.getByRole("img", { name: "失敗" })).toHaveCount(
			choice === "拒否" ? 1 : 0,
		);
	});
}
test("停止・再接続・エラー復帰", async ({ page }) => {
	await page.goto("/iframe.html?id=chat-app--streaming&viewMode=story");
	await page.getByRole("button", { name: "停止" }).click();
	await expect(page.getByText("停止しました", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "接続する" }).click();
	await expect(page.getByText("接続済み", { exact: true })).toBeVisible();
	await page.goto("/iframe.html?id=chat-app--error&viewMode=story");
	await expect(page.getByRole("alert")).toBeVisible();
	await page.getByRole("button", { name: "再接続" }).click();
	await expect(page.getByRole("alert")).toHaveCount(0);
});
test("IME確定・改行・キーボード送信", async ({ page }) => {
	await page.goto("/iframe.html?id=chat-app--empty&viewMode=story");
	const input = page.getByRole("textbox");
	await input.fill("日本語の入力");
	await input.dispatchEvent("compositionstart");
	await input.dispatchEvent("keydown", {
		key: "Enter",
		code: "Enter",
		isComposing: true,
	});
	await expect(page.getByRole("log")).toBeEmpty();
	await input.dispatchEvent("compositionend");
	await input.press("Shift+Enter");
	await expect(input).toHaveValue("日本語の入力\n");
	await input.press("Enter");
	await expect(page.getByRole("log")).toContainText("日本語の入力");
});
test("回答コピー・対応する送信文と返信末尾へ移動", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/iframe.html?id=chat-app--completed&viewMode=story");
	await page.getByRole("button", { name: "回答をコピー" }).click();
	await expect(page.locator(".message").getByRole("status")).toHaveText(
		"コピーしました",
	);
	expect(
		(await page.evaluate(() => navigator.clipboard.readText())).replace(
			/\r\n/g,
			"\n",
		),
	).toBe(
		await page.locator(".text-type .sr-only").getAttribute("aria-label"),
	);
	await page.getByRole("button", { name: "送信メッセージへ移動" }).click();
	await expect(page.locator(".message.user")).toBeFocused();
	await expect(page.locator(".message.user")).toBeInViewport();
	await page.getByRole("button", { name: "回答の末尾へ移動" }).click();
	await expect(
		page.locator(".message.assistant .message-actions"),
	).toBeFocused();
	await expect(
		page.locator(".message.assistant .message-actions"),
	).toBeInViewport();
	await expect(page.locator(".message-author, .run-status")).toHaveCount(0);
});
test("TextTypeの開始・途中・終了とカーソル休止", async ({ page }, info) => {
	await page.clock.install();
	await page.goto("/iframe.html?id=chat-app--streaming&viewMode=story");
	const content = page.locator(".text-type > div");
	await expect(page.locator(".text-type")).toHaveAttribute(
		"data-typing",
		"true",
	);
	await info.attach("typing-start", {
		body: await page.screenshot(),
		contentType: "image/png",
	});
	await page.clock.runFor(400);
	await expect(content).toContainText("設定を確認");
	await info.attach("typing-middle", {
		body: await page.screenshot(),
		contentType: "image/png",
	});
	await page.clock.runFor(2000);
	await expect(page.locator(".text-type")).toHaveAttribute(
		"data-typing",
		"false",
	);
	await info.attach("typing-end", {
		body: await page.screenshot(),
		contentType: "image/png",
	});
	await page.getByRole("button", { name: "停止", exact: true }).click();
	await page.clock.runFor(4300);
	await expect(page.locator(".text-type-cursor")).toHaveCount(0);
});
for (const colorScheme of ["dark", "light"] as const) {
	test(`狭い幅・長文・コード: ${colorScheme}`, async ({ page }, info) => {
		await page.setViewportSize({ width: 320, height: 760 });
		await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
		await page.goto("/iframe.html?id=chat-app--completed&viewMode=story");
		await expect(page.getByText(/const config/)).toBeVisible();
		await expect(page.locator(".text-type")).toHaveAttribute(
			"data-typing",
			"false",
			{ timeout: 20000 },
		);
		await page.evaluate(() => document.fonts.ready);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		await info.attach(`narrow-${colorScheme}`, {
			body: await page.screenshot(),
			contentType: "image/png",
		});
	});
}
