// 両方のログアウト入口と再ログイン、入力の改行・送信を実UIで検証する。
import { test, expect } from "@playwright/test";

for (const colorScheme of ["dark", "light"] as const) {
	test(`ログアウト・改行・Ctrl+Enter: ${colorScheme}`, async ({
		page,
	}, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 760 });
		await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
		await page.goto("/iframe.html?id=chat-app--empty&viewMode=story");
		const input = page.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		await input.fill("1行目");
		await input.press("Enter");
		await page.keyboard.insertText("2行目");
		await input.press("Shift+Enter");
		await page.keyboard.insertText("3行目");
		await expect(input).toHaveText("1行目\n2行目\n3行目", {
			useInnerText: true,
		});
		await expect(page.getByRole("log")).toBeEmpty();
		await input.dispatchEvent("keydown", {
			key: "Enter",
			ctrlKey: true,
			isComposing: true,
		});
		await expect(page.getByRole("log")).toBeEmpty();
		await page.screenshot({ path: info.outputPath("multiline.png") });
		await input.press("Control+Enter");
		await expect(page.locator(".message.user")).toContainText("3行目");
		await page.getByRole("button", { name: "オプション" }).click();
		await expect(
			page.getByRole("menuitem", { name: "ログアウト" }),
		).toBeDisabled();
		await page.keyboard.press("Escape");
		await expect(page.getByText(/作業が完了しました/)).toBeVisible();
		await page.getByRole("button", { name: "オプション" }).click();
		await page.screenshot({ path: info.outputPath("logout-menu.png") });
		await page.getByRole("menuitem", { name: "ログアウト" }).click();
		await expect(page.getByRole("region", { name: "認証" })).toBeVisible();
		await expect(page.locator(".message")).toHaveCount(0);
		await page.screenshot({ path: info.outputPath("logged-out.png") });
		await page
			.getByRole("button", { name: "ChatGPT", exact: true })
			.click();
		await input.fill("/log");
		await expect(
			page.getByRole("option", { name: /logout/ }),
		).toBeVisible();
		await page.screenshot({ path: info.outputPath("logout-command.png") });
		await input.press("Tab");
		await expect(input).toHaveText("/logout");
		await input.press("Control+Enter");
		await expect(page.getByRole("region", { name: "認証" })).toBeVisible();
		await expect(page.locator(".message")).toHaveCount(0);
		expect(errors).toEqual([]);
	});
}
