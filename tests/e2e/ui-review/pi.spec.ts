// Pi最小版の状態を既存チャットで表示し、送信・停止・再送とエラーを確認する。
import { test, expect } from "@playwright/test";

test("Piの逐次応答・停止・再送・新規会話", async ({ page }, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	await page.goto("/iframe.html?id=chat-app--pi&viewMode=story");
	await page.getByRole("textbox").fill("ファイルを確認してください");
	await page.getByRole("button", { name: "送信", exact: true }).click();
	await expect(page.getByText(/Piからの応答/)).toBeVisible();
	await page.screenshot({ path: info.outputPath("pi-streaming.png") });
	await page.getByRole("button", { name: "停止", exact: true }).click();
	await expect(page.getByText("停止しました", { exact: true })).toBeVisible();
	await page.getByRole("textbox").click();
	await page.getByRole("textbox").fill("続けてください");
	await page.screenshot({ path: info.outputPath("pi-stopped.png") });
	await page.getByRole("button", { name: "送信", exact: true }).click();
	await expect(page.getByText(/内容を確認しました。/)).toBeVisible();
	await expect(
		page.getByRole("button", { name: "停止", exact: true }),
	).toHaveCount(0);
	await page.screenshot({ path: info.outputPath("pi-completed.png") });
	await page.getByRole("button", { name: "新しいチャット" }).click();
	await expect(page.getByRole("log")).toBeEmpty();
	await info.attach("browser-errors", {
		body: JSON.stringify(errors),
		contentType: "application/json",
	});
	expect(errors).toEqual([]);
});
