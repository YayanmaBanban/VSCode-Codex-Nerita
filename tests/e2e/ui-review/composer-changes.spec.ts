// Changesの階層・検索・戻る操作を狭い画面と明暗テーマで確認する。
import { test, expect } from "@playwright/test";

for (const colorScheme of ["dark", "light"] as const) {
	test(`Changesの候補を表示して検索する: ${colorScheme}`, async ({
		page,
	}, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 820 });
		await page.emulateMedia({ colorScheme });
		await page.goto(
			"/iframe.html?id=chat-composer-sessions--references&viewMode=story",
		);
		await page
			.getByRole("textbox", { name: "Codexへのメッセージ" })
			.fill("#");
		await expect(page.getByRole("option")).toHaveText([
			"添付ファイル",
			"ファイルとディレクトリ",
			"シンボル",
			"セッション",
			"Changes",
		]);
		await page.screenshot({
			path: info.outputPath(`categories-${colorScheme}.png`),
		});
		await page
			.getByRole("option", { name: "Changes", exact: true })
			.click();
		await expect(page.getByRole("option")).toHaveCount(4);
		await expect(page.getByRole("option").nth(0)).toContainText(
			"Uncommitted",
		);
		await expect(page.getByRole("option").nth(1)).toContainText("Staged");
		await expect(page.getByRole("option").nth(2)).toContainText(
			"Since last commit",
		);
		await expect(page.getByRole("option").nth(3)).toContainText(
			"Current branch vs main",
		);
		await info.attach("changes-candidates", {
			body: await page.screenshot({
				path: info.outputPath(`changes-${colorScheme}.png`),
			}),
			contentType: "image/png",
		});
		const search = page.getByRole("combobox", { name: "Changesを検索" });
		await search.fill("main");
		await expect(page.getByRole("option")).toHaveCount(1);
		await search.fill("存在しない候補");
		await expect(page.getByRole("listbox")).toHaveText(
			"候補がありません。",
		);
		await page.getByRole("button", { name: "カテゴリへ戻る" }).click();
		await expect(page.getByRole("option")).toHaveCount(5);
		await page
			.getByRole("option", { name: "Changes", exact: true })
			.click();
		await page.getByRole("option", { name: /^Staged/ }).click();
		const input = page.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		await expect(input.locator(".inline-path-reference")).toHaveCount(1);
		await input
			.getByRole("button", { name: "Staged の内容を表示" })
			.click();
		await expect(page.getByLabel("表示した差分")).toHaveText("staged");
		await page
			.getByRole("button", { name: "エディタグループへ移動" })
			.click();
		await expect(input.locator(".inline-path-reference")).toHaveCount(1);
		await page.screenshot({
			path: info.outputPath(`changes-chip-${colorScheme}.png`),
		});
		await input.press("End");
		await input.press("Enter");
		await expect(page.getByLabel("送信した参照")).toContainText(
			'"changeScopes":["staged"]',
		);
		expect(errors).toEqual([]);
	});
}
