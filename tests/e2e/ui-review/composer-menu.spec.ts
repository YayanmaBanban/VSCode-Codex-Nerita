// 候補の検索・カーソル位置への挿入と Tab キーの優先順位を検証する。
import { test, expect } from "@playwright/test";

test("候補のキーボード選択・検索・送信とTabの2スペース", async ({
	page,
}, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/iframe.html?id=chat-composer-menu--ready&viewMode=story");
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await input.fill("前文後文");
	await input.press("Home");
	await input.press("ArrowRight");
	await input.press("ArrowRight");
	await input.press("#");
	await expect(
		page.getByRole("listbox", { name: "コンテキスト" }),
	).toBeVisible();
	await page.screenshot({ path: info.outputPath("categories.png") });
	await input.press("Enter");
	await expect(
		page.getByRole("listbox", { name: "添付ファイル" }),
	).toBeVisible();
	await page
		.getByRole("combobox", { name: "添付ファイルを検索" })
		.fill("sample");
	await page.screenshot({ path: info.outputPath("attachments.png") });
	await page
		.getByRole("combobox", { name: "添付ファイルを検索" })
		.press("Tab");
	await expect(input).toHaveText("前文日本語 sample.md 後文");
	await expect(input.locator(".inline-path-reference")).toHaveCount(1);
	await expect(
		input.getByTitle("file:///D:/workspace/sample.md"),
	).toBeVisible();
	await page.screenshot({ path: info.outputPath("attachment-chip.png") });
	await input.press("Tab");
	expect(await input.textContent()).toBe("前文日本語 sample.md   後文");
	await input.press("Shift+Tab");
	expect(await input.textContent()).toBe("前文日本語 sample.md 後文");
	await input.press("Control+Enter");
	await expect(page.locator(".message.user")).toContainText(
		"前文日本語 sample.md 後文",
	);
	await expect(page.getByText(/作業が完了しました/)).toBeVisible();
	await input.fill("@");
	await expect(page.getByRole("listbox", { name: "スキル" })).toBeVisible();
	await input.press("ArrowDown");
	await input.press("Tab");
	await expect(input).toHaveText("@test");
	await input.fill("文中@");
	await expect(page.getByRole("listbox")).toHaveCount(0);
	await input.fill("/");
	await expect(page.getByRole("option", { name: /new/ })).toBeVisible();
	await input.press("Enter");
	await expect(input).toHaveText("/new");
	await input.press("Control+Enter");
	await expect(page.locator(".message")).toHaveCount(0);
	expect(errors).toEqual([]);
});

for (const theme of ["dark", "light"] as const) {
	test(`PlanとGoalのスラッシュ補完: ${theme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 900 });
		await page.emulateMedia({ colorScheme: theme });
		await page.goto(
			"/iframe.html?id=chat-composer-menu--ready&viewMode=story",
		);
		const input = page.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		await expect(input).toBeVisible({ timeout: 30_000 });
		await input.fill("/");
		await expect(
			page.getByRole("option", { name: /\/plan/ }),
		).toBeVisible();
		await expect(
			page.getByRole("option", { name: /\/goal/ }),
		).toBeVisible();
		await info.attach("slash-modes", {
			body: await page.screenshot({
				path: info.outputPath("slash-modes.png"),
			}),
			contentType: "image/png",
		});
		await input.fill("/pl");
		await input.press("Enter");
		await expect(input).toHaveText("/plan");
		await input.fill("/go");
		await page.getByRole("option", { name: /\/goal/ }).click();
		await expect(input).toHaveText("/goal");
		expect(errors).toEqual([]);
	});
}

test("行頭の判定・クリック挿入・Esc後の再表示・IME確定", async ({ page }) => {
	await page.goto("/iframe.html?id=chat-composer-menu--ready&viewMode=story");
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await input.fill("文中/");
	await expect(page.getByRole("listbox")).toHaveCount(0);
	await input.press("Shift+Enter");
	await input.press("@");
	await expect(page.getByRole("listbox", { name: "スキル" })).toBeVisible();
	await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
	await expect(page.locator(".message")).toHaveCount(0);
	await expect(page.getByRole("listbox")).toBeVisible();
	await page.getByRole("option", { name: /review/ }).click();
	await expect(input).toContainText("@review");
	await input.fill("#");
	await input.press("Escape");
	await input.press("Control+a");
	await input.press("Backspace");
	await expect(input).toHaveText("");
	await input.press("#");
	await expect(
		page.getByRole("listbox", { name: "コンテキスト" }),
	).toBeVisible();
	await input.press("ArrowRight");
	await input.press("a");
	await expect(
		page.getByRole("listbox", { name: "添付ファイル" }),
	).toBeVisible();
	await page.getByRole("option", { name: /alpha.ts/ }).click();
	await expect(input).toHaveText("alpha.ts");
	await page
		.getByRole("button", { name: "入力エリアを拡張", exact: true })
		.click();
	await input.fill("#");
	await expect(
		page.getByRole("combobox", { name: "コンテキストを検索" }),
	).toBeInViewport();
});

for (const colorScheme of ["dark", "light"] as const) {
	test(`添付参照の取り外しとUndo: ${colorScheme}`, async ({ page }, info) => {
		await page.setViewportSize({ width: 320, height: 820 });
		await page.emulateMedia({ colorScheme });
		await page.goto(
			"/iframe.html?id=chat-composer-menu--ready&viewMode=story",
		);
		const input = page.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		await input.fill("#");
		await input.press("Enter");
		await page.getByRole("option", { name: /日本語 sample.md/ }).click();
		await expect(input.locator(".inline-path-reference")).toHaveCount(1);
		await page.screenshot({
			path: info.outputPath(`attachment-chip-${colorScheme}.png`),
		});
		await input
			.getByRole("button", { name: "日本語 sample.md の参照を取り外す" })
			.click();
		await expect(input.locator(".inline-path-reference")).toHaveCount(0);
		await expect(
			page
				.locator(".attachments")
				.getByRole("button", { name: "日本語 sample.md を開く" }),
		).toBeVisible();
		await input.press("Control+z");
		await expect(input.locator(".inline-path-reference")).toHaveCount(1);
	});
	test(`コンテキスト入口と選択解除: ${colorScheme}`, async ({
		page,
	}, info) => {
		await page.setViewportSize({ width: 320, height: 820 });
		await page.emulateMedia({ colorScheme });
		await page.goto(
			"/iframe.html?id=chat-composer-menu--ready&viewMode=story",
		);
		const input = page.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		await input.fill("#");
		await page
			.getByRole("option", {
				name: "ファイルとディレクトリ",
				exact: true,
			})
			.click();
		await expect(
			page.getByRole("option", { name: /project\// }),
		).toBeVisible();
		await page.screenshot({
			path: info.outputPath(`entry-${colorScheme}.png`),
		});
		await input.press("Escape");
		await expect(page.getByRole("listbox")).toHaveCount(0);
		await input.fill("#");
		await input.press("x");
		await expect(page.getByText("候補がありません。")).toBeVisible();
		await input.press("Enter");
		await expect(page.locator(".message")).toHaveCount(0);
	});
}
