// チップと添付一覧の開く操作を、本文編集・送信から分離して確認する。
import { test, expect } from "@playwright/test";

test("ファイルとフォルダのチップをマウスとキーボードで開く", async ({
	page,
}, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(
		"/iframe.html?id=chat-composer-references--restored&viewMode=story",
	);
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await input
		.getByRole("button", { name: "日本語 sample.md を開く" })
		.click();
	await expect(page.getByLabel("開いた参照")).toHaveText(
		"file:///D:/workspace/日本語%20sample.md",
	);
	const folder = input.getByRole("button", { name: "src をExplorerで表示" });
	await folder.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByLabel("開いた参照")).toHaveText(
		"file:///D:/workspace/src",
	);
	await expect(input).toHaveText("前文日本語 sample.md と src 後文");
	await expect(page.locator(".message.user")).toHaveCount(0);
	await page.screenshot({ path: info.outputPath("open-folder-focus.png") });
	await input.getByRole("button", { name: "src の参照を取り外す" }).click();
	await expect(input.locator(".inline-path-reference")).toHaveCount(1);
	await expect(page.getByLabel("開いた参照")).toHaveText(
		"file:///D:/workspace/src",
	);
	expect(errors).toEqual([]);
});

test("添付画像を一覧と本文のチップから開ける", async ({ page }, info) => {
	await page.goto(
		"/iframe.html?id=chat-composer-settings--connected&viewMode=story",
	);
	await page.getByRole("button", { name: "ファイルを添付" }).click();
	await page
		.locator(".attachments")
		.getByRole("button", { name: "design.png を開く" })
		.click();
	await expect(page.getByLabel("最後の要求")).toContainText(
		'"type":"attachment/open"',
	);
	await expect(page.getByLabel("最後の要求")).toContainText(
		'"attachmentId":"image"',
	);
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await input.fill("#");
	await input.press("Enter");
	await page.getByRole("option", { name: /design.png/ }).click();
	await input.getByRole("button", { name: "design.png を開く" }).click();
	await expect(page.getByLabel("最後の要求")).toContainText(
		'"type":"reference/open"',
	);
	await expect(page.getByLabel("最後の要求")).toContainText(
		'"uri":"file:///workspace/design.png"',
	);
	await expect(input).toHaveText("design.png");
	await expect(page.locator(".message.user")).toHaveCount(0);
	await page.screenshot({ path: info.outputPath("open-attachment.png") });
});
