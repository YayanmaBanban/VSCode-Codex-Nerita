// 専用・汎用カードの内容、完了時の自動折り畳みと再展開を検証する。
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	test(`ツールカードの開閉と表示: ${theme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") errors.push(message.text());
		});
		await page.emulateMedia({ colorScheme: theme });
		await page.setViewportSize({ width: 320, height: 900 });
		await page.goto(
			"/iframe.html?id=chat-tool-cards--running&viewMode=story",
		);
		const guardian = page.getByRole("button", {
			name: "Guardian Review 実行中",
		});
		const edit = page.getByRole("button", { name: "Editing files 実行中" });
		await expect(guardian).toHaveAttribute("aria-expanded", "true");
		await expect(page.getByText("変更前", { exact: true })).toBeVisible();
		await expect(
			page.getByText("実行結果を待っています。", { exact: true }),
		).toBeVisible();
		await edit.click();
		await expect(edit).toHaveAttribute("aria-expanded", "false");
		await expect(guardian).toHaveAttribute("aria-expanded", "true");
		await edit.focus();
		await page.keyboard.press("Enter");
		await expect(edit).toHaveAttribute("aria-expanded", "true");
		await info.attach("running", {
			body: await page.screenshot({ fullPage: true }),
			contentType: "image/png",
		});
		await page.getByRole("button", { name: "完了通知を受信" }).click();
		const completed = page.getByRole("button", {
			name: "Guardian Review 完了",
		});
		await expect(completed).toHaveAttribute("aria-expanded", "false");
		await expect(
			page.getByRole("button", { name: "Editing files 完了" }),
		).toHaveAttribute("aria-expanded", "false");
		await expect(
			page.getByRole("button", { name: "Guardian Review 失敗" }),
		).toHaveAttribute("aria-expanded", "true");
		await completed.click();
		await expect(
			page.getByText("バージョン確認のため承認しました。", {
				exact: true,
			}),
		).toBeVisible();
		await page.getByRole("button", { name: "完了通知を受信" }).click();
		await expect(completed).toHaveAttribute("aria-expanded", "true");
		await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 320);
		await info.attach("completed-reopened", {
			body: await page.screenshot({ fullPage: true }),
			contentType: "image/png",
		});
		expect(errors).toEqual([]);
	});
}
