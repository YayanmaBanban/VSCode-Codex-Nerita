// 一覧の検索と削除、長いパスの折返しを明暗テーマで確認する。
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	test(`Trust 管理 ${theme}`, async ({ page }, info) => {
		const errors: string[] = [];
		await page.emulateMedia({ colorScheme: theme });
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.goto(
			`/iframe.html?id=trust-manager--default&viewMode=story&globals=theme:${theme}`,
		);
		await expect(page.getByRole("article")).toHaveCount(3);
		await page.screenshot({
			path: info.outputPath(`${theme}-list.png`),
			fullPage: true,
		});
		await page.getByRole("searchbox").fill("archived");
		await expect(page.getByRole("article")).toHaveCount(1);
		await page.getByRole("button", { name: "記録を削除" }).click();
		await expect(
			page.getByText("一致するフォルダーがありません。"),
		).toBeVisible();
		await page.getByRole("searchbox").fill("");
		await expect(page.getByRole("article")).toHaveCount(2);
		await page.getByRole("button", { name: "信頼を取り消す" }).click();
		await expect(
			page.getByRole("button", { name: "信頼を取り消す" }),
		).toHaveCount(0);
		await page.screenshot({
			path: info.outputPath(`${theme}-updated.png`),
			fullPage: true,
		});
		expect(errors).toEqual([]);
	});
}
