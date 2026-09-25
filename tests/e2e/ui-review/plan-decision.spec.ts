// Plan 完了カードの選択肢と閉じる操作を画面で確認する。
import { test, expect } from "@playwright/test";

test("Plan完了カードを表示して選択できる", async ({ page }, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	await page.goto(
		"/iframe.html?id=chat-plan-decision--completed&viewMode=story",
	);
	const card = page.getByRole("region", { name: "Planの実装" });
	await expect(card).toBeVisible();
	for (const label of [
		"このセッションで実装する",
		"新規セッションで実装する",
		"プランを続ける",
	]) {
		await expect(card.getByRole("button", { name: label })).toBeEnabled();
	}
	await page.screenshot({ path: info.outputPath("plan-decision.png") });
	await info.attach("plan-decision", {
		path: info.outputPath("plan-decision.png"),
		contentType: "image/png",
	});
	await card.getByRole("button", { name: "プランを続ける" }).click();
	await expect(card).toHaveCount(0);
	expect(errors).toEqual([]);
});
