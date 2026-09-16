// 性格設定のメニュー、保存・更新、固定状態を狭い明暗画面で検証する。
import { test, expect } from "@playwright/test";
for (const colorScheme of ["dark", "light"] as const) {
	test(`性格設定の編集・保存・キーボード操作: ${colorScheme}`, async ({
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
		await page.goto(
			"/iframe.html?id=chat-personality--editable&viewMode=story",
		);
		await page
			.getByRole("button", { name: "オプション", exact: true })
			.click();
		await expect(
			page.getByRole("menuitem", { name: "性格設定" }),
		).toBeVisible();
		await info.attach("options-menu", {
			body: await page.screenshot({ path: info.outputPath("menu.png") }),
			contentType: "image/png",
		});
		await page.getByRole("menuitem", { name: "性格設定" }).click();
		const dialog = page.getByRole("dialog", { name: "性格設定" });
		await expect(dialog).toBeVisible();
		const global = dialog.getByRole("region", {
			name: "グローバル",
			exact: true,
		});
		const workspace = dialog.getByRole("region", {
			name: "ワークスペース",
			exact: true,
		});
		await expect(
			global.getByRole("textbox", { name: "グローバルの指示" }),
		).toHaveText("日本語で簡潔に回答する。");
		await global
			.getByRole("textbox", { name: "グローバルの指示" })
			.fill("結論と判断理由を日本語で説明する。");
		await global.getByRole("button", { name: "更新", exact: true }).click();
		await expect(
			global.getByRole("button", { name: "更新", exact: true }),
		).toBeDisabled();
		await global
			.getByRole("textbox", { name: "グローバルのプリセット名" })
			.fill("技術説明");
		await global.getByRole("button", { name: "保存", exact: true }).click();
		await expect(
			global.getByRole("button", { name: "更新", exact: true }),
		).toBeDisabled();
		await global.getByRole("combobox").click();
		await page.getByRole("option", { name: "簡潔", exact: true }).click();
		await expect(
			global.getByRole("textbox", { name: "グローバルのプリセット名" }),
		).toHaveValue("簡潔");
		await workspace
			.getByRole("textbox", { name: "ワークスペースのプリセット名" })
			.fill("プロジェクト");
		await workspace
			.getByRole("textbox", { name: "ワークスペースの指示" })
			.fill("既存設計に沿って説明する。");
		await workspace
			.getByRole("button", { name: "保存", exact: true })
			.click();
		await expect(
			workspace.getByRole("button", { name: "更新", exact: true }),
		).toBeDisabled();
		await global
			.getByRole("button", { name: "グローバル", exact: true })
			.click();
		await expect(
			global.getByRole("textbox", { name: "グローバルの指示" }),
		).toBeHidden();
		await global
			.getByRole("button", { name: "グローバル", exact: true })
			.click();
		await dialog
			.locator(":scope > div.overflow-y-auto")
			.evaluate((element) => {
				element.scrollTop = 0;
			});
		await info.attach(`personality-${colorScheme}`, {
			body: await page.screenshot({ path: info.outputPath("panel.png") }),
			contentType: "image/png",
		});
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
		await expect(
			page.getByRole("button", { name: "オプション", exact: true }),
		).toBeFocused();
		expect(errors).toEqual([]);
	});
}
test("config.toml の指示は表示して編集を禁止する", async ({ page }, info) => {
	await page.goto(
		"/iframe.html?id=chat-personality--configured&viewMode=story",
	);
	await page.getByRole("button", { name: "オプション", exact: true }).click();
	await page.getByRole("menuitem", { name: "性格設定" }).click();
	const dialog = page.getByRole("dialog", { name: "性格設定" });
	for (const scope of ["グローバル", "ワークスペース"]) {
		await expect(
			dialog.getByRole("textbox", { name: `${scope}の指示` }),
		).toHaveAttribute("contenteditable", "false");
		await expect(
			dialog.getByRole("textbox", { name: `${scope}のプリセット名` }),
		).toBeDisabled();
	}
	await expect(
		dialog.getByRole("textbox", { name: "グローバルの指示" }),
	).toContainText("技術的な判断理由");
	await info.attach("configured", {
		body: await page.screenshot({
			path: info.outputPath("configured.png"),
		}),
		contentType: "image/png",
	});
	await dialog.getByRole("button", { name: "性格設定を閉じる" }).click();
	await expect(dialog).toBeHidden();
});
