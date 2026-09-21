// 認証状態・取消・認証待ちからのモデル選択を明暗・狭幅で確認する。
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	test(`Pi認証とモデル選択: ${theme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 900 });
		await page.emulateMedia({ colorScheme: theme });
		await page.goto(
			"/iframe.html?id=chat-piaccount--authentication&viewMode=story",
		);
		await expect(page.getByText("local: 認証未設定")).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "オプション", exact: true }),
		).toBeVisible();
		await info.attach("auth-required", {
			body: await page.screenshot({
				path: info.outputPath("required.png"),
			}),
			contentType: "image/png",
		});
		await page
			.getByRole("button", { name: "オプション", exact: true })
			.click();
		const account = page.getByRole("menuitem", {
			name: "認証情報を管理",
			exact: true,
		});
		await expect(account).toBeVisible();
		const items = await page.getByRole("menuitem").allTextContents();
		expect(
			items.findIndex((item) => item.includes("認証情報を管理")),
		).toBeLessThan(items.findIndex((item) => item.includes("性格設定")));
		await info.attach("account-menu", {
			body: await page.screenshot({ path: info.outputPath("menu.png") }),
			contentType: "image/png",
		});
		await account.click();
		await expect(
			page.getByRole("button", { name: "認証をキャンセル" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "新しいチャット", exact: true }),
		).toBeDisabled();
		await info.attach("authenticating", {
			body: await page.screenshot({
				path: info.outputPath("authenticating.png"),
			}),
			contentType: "image/png",
		});
		await page.getByRole("button", { name: "認証をキャンセル" }).click();
		await page
			.getByRole("button", { name: "オプション", exact: true })
			.click();
		await expect(account).toBeEnabled();
		await page.keyboard.press("Escape");
		await page.getByRole("combobox", { name: "Pi Model" }).click();
		await page.getByRole("option", { name: /Second/ }).click();
		await expect(
			page.getByRole("combobox", { name: "Pi Model" }),
		).toContainText("Second");
		await info.attach("model-selected", {
			body: await page.screenshot({
				path: info.outputPath("selected.png"),
			}),
			contentType: "image/png",
		});
		expect(errors).toEqual([]);
	});
}
