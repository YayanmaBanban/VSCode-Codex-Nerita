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
	await page.getByRole("button", { name: "送信 ↑" }).click();
	await expect(page.getByRole("button", { name: "■ 停止" })).toBeVisible();
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
			page.getByRole("region", { name: "作業状況" }),
		).toContainText(choice === "拒否" ? "失敗" : "完了");
	});
}
test("停止・再接続・エラー復帰", async ({ page }) => {
	await page.goto("/iframe.html?id=chat-app--streaming&viewMode=story");
	await page.getByRole("button", { name: "■ 停止" }).click();
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
for (const colorScheme of ["dark", "light"] as const) {
	test(`狭い幅・長文・コード: ${colorScheme}`, async ({ page }, info) => {
		await page.setViewportSize({ width: 320, height: 760 });
		await page.emulateMedia({ colorScheme });
		await page.goto("/iframe.html?id=chat-app--completed&viewMode=story");
		await expect(page.getByText(/const config/)).toBeVisible();
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
