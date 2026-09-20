// ワークスペースの階層選択から本文のパス挿入・送信まで確認する。
import { test, expect } from "@playwright/test";

for (const colorScheme of ["dark", "light"] as const) {
	test(`ファイルとフォルダのパスをカーソル位置に挿入: ${colorScheme}`, async ({
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
			"/iframe.html?id=chat-composer-menu--ready&viewMode=story",
		);
		const input = page.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		await input.fill("前文後文");
		await input.press("Home");
		await input.press("ArrowRight");
		await input.press("ArrowRight");
		await input.press("#");
		await page
			.getByRole("option", {
				name: "ファイルとディレクトリ",
				exact: true,
			})
			.click();
		await page.getByRole("option", { name: /project\// }).click();
		await expect(page.getByRole("option", { name: /src\// })).toBeVisible();
		await page.screenshot({ path: info.outputPath("directory.png") });
		const search = page.getByRole("combobox", {
			name: "ファイルとディレクトリを検索",
		});
		await search.fill("sample");
		await expect(page.getByRole("option", { name: /src\// })).toHaveCount(
			0,
		);
		await page.getByRole("option", { name: /日本語 sample.md/ }).click();
		await expect(input).toHaveText("前文日本語 sample.md 後文");
		await expect(input).toBeFocused();
		await input.press("Control+z");
		await expect(input).not.toContainText("sample.md");
		await input.press("Escape");
		await input.press("Control+a");
		await input.press("Backspace");
		await expect(input).toHaveText("");
		await input.press("#");
		await input.press("ArrowDown");
		await input.press("Enter");
		await expect(
			page.getByRole("option", { name: /project\// }),
		).toBeVisible();
		await input.press("ArrowRight");
		await expect(page.getByRole("option", { name: /src\// })).toBeVisible();
		await page.getByRole("option", { name: /src\// }).click();
		await page.getByRole("option", { name: /ComposerInput.tsx/ }).click();
		await expect(input).toHaveText("ComposerInput.tsx");
		await input.press("End");
		await input.press("#");
		await page
			.getByRole("option", {
				name: "ファイルとディレクトリ",
				exact: true,
			})
			.click();
		await page.getByRole("option", { name: /project\// }).click();
		await page.getByRole("option", { name: /empty\// }).click();
		await page
			.getByRole("option", { name: /このフォルダのパスを挿入/ })
			.click();
		await expect(input).toHaveText("ComposerInput.tsx empty");
		await page.screenshot({ path: info.outputPath("inserted.png") });
		await expect(input.locator(".inline-path-reference")).toHaveCount(2);
		await input.press("Control+Enter");
		await expect(page.locator(".message.user")).toContainText(
			"D:\\workspace\\project\\empty",
		);
		await expect(page.locator(".message.user")).toContainText(
			"D:\\workspace\\project\\src\\ComposerInput.tsx",
		);
		expect(errors).toEqual([]);
	});
}

test("階層を戻り、読み込み失敗から復帰してキャンセルする", async ({
	page,
}, info) => {
	await page.goto("/iframe.html?id=chat-composer-menu--ready&viewMode=story");
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await input.fill("#");
	await page
		.getByRole("option", { name: "ファイルとディレクトリ", exact: true })
		.click();
	await page.getByRole("option", { name: /project\// }).click();
	await page.getByRole("option", { name: /unavailable\// }).click();
	await expect(page.getByRole("listbox").getByRole("status")).toContainText(
		"フォルダを読み込めませんでした。",
	);
	await page.screenshot({ path: info.outputPath("read-error.png") });
	await page.getByRole("button", { name: "上の階層へ戻る" }).click();
	await expect(page.getByRole("option", { name: /src\// })).toBeVisible();
	await input.press("ArrowLeft");
	await expect(page.getByRole("option", { name: /project\// })).toBeVisible();
	await input.press("ArrowLeft");
	await expect(
		page.getByRole("listbox", { name: "コンテキスト" }),
	).toBeVisible();
	await input.press("Escape");
	await expect(page.getByRole("listbox")).toHaveCount(0);
	await expect(input).toHaveText("#");
	await expect(page.locator(".message")).toHaveCount(0);
});
