// シンボルの検索・位置付きチップ・コピー復元・送信をブラウザで確認する。
import { test, expect } from "@playwright/test";

for (const colorScheme of ["dark", "light"] as const) {
	test(`シンボルを選択し定義を開きカット後も位置を保持: ${colorScheme}`, async ({
		page,
	}, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page
			.context()
			.grantPermissions(["clipboard-read", "clipboard-write"]);
		await page.setViewportSize({ width: 320, height: 820 });
		await page.emulateMedia({ colorScheme });
		await page.goto(
			"/iframe.html?id=chat-composer-symbols--search&viewMode=story",
		);
		const input = page.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		await input.fill("#");
		await page
			.getByRole("option", { name: "シンボル", exact: true })
			.click();
		await expect(page.getByRole("listbox")).toContainText(
			"シンボル名を入力してください。",
		);
		const search = page.getByRole("combobox", { name: "シンボルを検索" });
		await search.fill("User");
		await expect(page.getByRole("option")).toHaveCount(2);
		await page.screenshot({
			path: info.outputPath(`symbols-${colorScheme}.png`),
		});
		await search.press("ArrowDown");
		await search.press("Enter");
		await expect(input).toHaveText("UserService");
		await input
			.getByRole("button", { name: "UserService を開く", exact: true })
			.click();
		const opened = page.getByLabel("開いた参照");
		await expect(opened).toContainText('"line":8');
		await expect(opened).toContainText("src/tests/UserService.ts");
		await input.press("Control+a");
		await page.keyboard.press("Control+x");
		await expect(input).toHaveText("");
		await page.keyboard.press("Control+v");
		await expect(input.locator(".inline-path-reference")).toHaveCount(1);
		await input
			.getByRole("button", { name: "UserService を開く", exact: true })
			.focus();
		await page.keyboard.press("Enter");
		await expect(opened).toContainText('"line":8');
		await expect(page.locator(".message.user")).toHaveCount(0);
		await page.screenshot({
			path: info.outputPath(`symbol-chip-${colorScheme}.png`),
		});
		await input.press("End");
		await input.press("Enter");
		await expect(page.locator(".message.user")).toContainText(
			"D:\\workspace\\project\\src\\tests\\UserService.ts:9:1 (UserService)",
		);
		expect(errors).toEqual([]);
	});
}

test("空結果・失敗から再検索し、古い応答を無視する", async ({ page }) => {
	await page.goto(
		"/iframe.html?id=chat-composer-symbols--search&viewMode=story",
	);
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await input.fill("#");
	await page.getByRole("option", { name: "シンボル", exact: true }).click();
	const search = page.getByRole("combobox", { name: "シンボルを検索" });
	await search.fill("missing");
	await expect(page.getByRole("listbox")).toContainText("候補がありません。");
	await search.fill("error");
	await expect(page.getByRole("listbox")).toContainText(
		"検索できませんでした。",
	);
	await search.fill("slow");
	await expect(page.getByLabel("検索したシンボル")).toContainText("slow");
	await search.fill("User");
	await expect(page.getByRole("option")).toHaveCount(2);
	await expect(page.getByLabel("検索完了")).toContainText("slow");
	await expect(page.getByRole("option")).toHaveCount(2);
	await search.press("Escape");
	await expect(page.getByRole("listbox")).toHaveCount(0);
	await expect(input).toHaveText("#");
	await expect(page.locator(".message.user")).toHaveCount(0);
});
