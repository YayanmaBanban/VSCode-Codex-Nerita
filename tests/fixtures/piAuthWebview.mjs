// 実認証エディターの入力待ちを閉じ、次の認証へ秘密値や待機を持ち越さないことを確認する。
import { expect } from "@playwright/test";
import path from "node:path";

/** 外部ログインを行わず、実 Webview と Host の取消しを確認する。 */
export async function checkPiAuthCancellation(page, chat, output) {
	const open = async () => {
		await chat
			.getByRole("button", { name: "オプション", exact: true })
			.click();
		await chat
			.getByRole("menuitem", { name: "認証情報を管理", exact: true })
			.click();
		let auth;
		await expect(async () => {
			for (const candidate of page.frames()) {
				if (
					await candidate
						.getByRole("searchbox", { name: "認証先を検索" })
						.count()
				) {
					auth = candidate;
				}
			}
			expect(auth).toBeDefined();
		}).toPass({ timeout: 15000 });
		await auth.getByRole("searchbox").fill("anthropic");
		await auth
			.getByRole("button", { name: "Anthropic", exact: true })
			.click();
		await auth
			.getByRole("button", { name: "APIキーを設定", exact: true })
			.click();
		await expect(auth.locator('input[type="password"]')).toBeVisible();
		return auth;
	};
	const first = await open();
	await first
		.locator('input[type="password"]')
		.fill("fixture-never-submitted");
	await page.screenshot({ path: path.join(output, "auth-pending.png") });
	await page.keyboard.press("Control+w");
	await expect(
		chat.getByRole("button", { name: "認証をキャンセル" }),
	).toHaveCount(0);
	const next = await open();
	await expect(next.locator('input[type="password"]')).toHaveValue("");
	await next.getByRole("button", { name: "キャンセル", exact: true }).click();
	await expect(next.getByRole("alert")).toHaveText(
		"認証をキャンセルしました。",
	);
	await expect(next.locator('input[type="password"]')).toHaveCount(0);
	await page.screenshot({ path: path.join(output, "auth-cancelled.png") });
	await page.keyboard.press("Control+w");
	await expect(
		chat.getByRole("button", { name: "接続済み", exact: true }),
	).toBeVisible();
}
