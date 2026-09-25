// チップの復元・コピー・削除・Undo・コード貼り付けとの共存を確認する。
import { test, expect } from "@playwright/test";
import { paste, select } from "./composerHelpers";

test("上下キーでチップのある行から戻り、Shift選択で参照を削除できる", async ({
	page,
}) => {
	await page.goto(
		"/iframe.html?id=chat-composer-references--restored&viewMode=story",
	);
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await input.waitFor({ state: "visible" });
	await expect(input.locator(".inline-path-reference")).toHaveCount(2);
	await select(input.locator("p > span[data-lexical-text]").last(), 3);
	await page.keyboard.press("Shift+Enter");
	await page.keyboard.insertText("次の行");
	await page.keyboard.press("Home");
	await page.keyboard.press("ArrowUp");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("End");
	await page.keyboard.insertText("追記");
	await expect(
		input.locator("p > span[data-lexical-text]").last(),
	).toHaveText("次の行追記");
	await expect(input.locator("br")).toHaveCount(1);
	await select(input.locator("p > span[data-lexical-text]").first(), 2);
	await page.keyboard.press("Shift+ArrowRight");
	await page.keyboard.press("Backspace");
	await expect(input.locator(".inline-path-reference")).toHaveCount(1);
	await page.keyboard.press("Control+z");
	await expect(input.locator(".inline-path-reference")).toHaveCount(2);
});

for (const direction of ["ArrowRight", "ArrowLeft"] as const) {
	test(`矢印キーでチップを通過して本文の編集を続ける: ${direction}`, async ({
		page,
	}, info) => {
		await page.goto(
			"/iframe.html?id=chat-composer-references--restored&viewMode=story",
		);
		const input = page.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		await input.waitFor({ state: "visible" });
		await expect(input.locator(".inline-path-reference")).toHaveCount(2);
		const texts = input.locator("p > span[data-lexical-text]");
		await select(
			direction === "ArrowRight" ? texts.first() : texts.nth(1),
			direction === "ArrowRight" ? 2 : 0,
		);
		await page.keyboard.press(direction);
		await page.keyboard.press(direction);
		await page.keyboard.insertText("追記");
		await expect(input).toHaveText(
			direction === "ArrowRight"
				? "前文日本語 sample.md 追記と src 後文"
				: "前追記文日本語 sample.md と src 後文",
		);
		await expect(input.locator(".inline-path-reference")).toHaveCount(2);
		await expect(input).toBeFocused();
		await page.screenshot({
			path: info.outputPath(`arrow-${direction}.png`),
		});
	});
}

test("参照を復元し、全文コピー・取り外し・Undo・送信できる", async ({
	page,
}, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	await page.goto(
		"/iframe.html?id=chat-composer-references--restored&viewMode=story",
	);
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await input.waitFor({ state: "visible" });
	const chips = input.locator(".inline-path-reference");
	await expect(chips).toHaveCount(2);
	await expect(input).toHaveText("前文日本語 sample.md と src 後文");
	await expect(
		input.getByTitle("D:\\workspace\\日本語 sample.md"),
	).toBeVisible();
	await page.screenshot({ path: info.outputPath("restored.png") });
	await input.press("Control+a");
	const copied = await input.evaluate((node) => {
		const clipboardData = new DataTransfer();
		node.dispatchEvent(
			new ClipboardEvent("copy", {
				clipboardData,
				bubbles: true,
				cancelable: true,
			}),
		);
		return clipboardData.getData("text/plain");
	});
	expect(copied).toBe(
		'前文"D:\\workspace\\日本語 sample.md" と D:\\workspace\\src 後文',
	);
	await input.press("ArrowRight");
	await input
		.getByRole("button", { name: "日本語 sample.md の参照を取り外す" })
		.click();
	await expect(chips).toHaveCount(1);
	await expect(input).toHaveText("前文 と src 後文");
	await input.press("Control+z");
	await expect(chips).toHaveCount(2);
	await page.getByRole("button", { name: "エディタグループへ移動" }).click();
	await expect(chips).toHaveCount(2);
	await expect(input).toHaveText("前文日本語 sample.md と src 後文");
	await input.press("Control+End");
	await paste(input, "code\n".repeat(250));
	await expect(input.locator("pre")).toBeVisible();
	await expect(chips).toHaveCount(2);
	await page.getByRole("button", { name: "コードブロックを削除" }).click();
	await expect(input.locator("pre")).toHaveCount(0);
	await expect(chips).toHaveCount(2);
	await input.press("Control+End");
	await input.press("Control+Enter");
	const sent = page.locator(".message.user");
	await expect(sent.locator(".message-reference")).toHaveCount(2);
	await expect(sent).toContainText("前文日本語 sample.md と src 後文");
	await expect(sent.getByRole("button", { name: /取り外す/ })).toHaveCount(0);
	await sent.getByRole("button", { name: "日本語 sample.md を開く" }).click();
	await expect(page.getByLabel("開いた参照")).toHaveText(
		"file:///D:/workspace/日本語%20sample.md",
	);
	await page.screenshot({ path: info.outputPath("sent-references.png") });
	expect(errors).toEqual([]);
});

test("Backspaceで参照を一つずつ削除しUndoで戻せる", async ({ page }) => {
	await page.goto(
		"/iframe.html?id=chat-composer-references--restored&viewMode=story",
	);
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await input.waitFor({ state: "visible" });
	await expect(input.locator(".inline-path-reference")).toHaveCount(2);
	await select(input.locator("p > span[data-lexical-text]").last(), 3);
	// 末尾の「 後文」を消した直後の Backspace はフォルダ参照全体を削除する。
	for (let index = 0; index < 4; index++) {
		await input.press("Backspace");
	}
	await expect(input.locator(".inline-path-reference")).toHaveCount(1);
	await expect(input).toHaveText("前文日本語 sample.md と");
	await input.press("Control+z");
	await expect(input.locator(".inline-path-reference")).toHaveCount(2);
});
