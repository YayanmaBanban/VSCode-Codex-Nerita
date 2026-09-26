import { expect } from "@playwright/test";

/** 起動時のコマンド登録を待ち、パレットで選択した操作だけを実行する。 */
export async function openCommand(page, title) {
	await page.bringToFront();
	const item = page
		.locator(".quick-input-list .monaco-list-row")
		.filter({ hasText: title })
		.first();
	await expect(async () => {
		await page.keyboard.press("Escape");
		await page.keyboard.press("F1");
		await page.locator(".quick-input-widget input").fill(`>${title}`);
		await expect(item).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 20000 });
	await item.click();
}
