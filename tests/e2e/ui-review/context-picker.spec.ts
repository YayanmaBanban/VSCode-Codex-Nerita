// ＋と # が同じ検索・参照挿入・最近使用を共有することを確認する。
import { openStory } from "../storyPage";
import { test, expect } from "@playwright/test";
import { expectSent, sentMessages, showState } from "../storyBridge";

for (const key of ["Escape", "Alt+ArrowLeft"]) {
	test(`${key}で1階層ずつ戻りルートのEscで閉じる`, async ({ page }) => {
		await openStory(
			page,
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
		await page.getByRole("option", { name: /project\// }).click();
		await page.getByRole("option", { name: /src\// }).click();
		const search = page.getByRole("combobox", {
			name: "ファイルとディレクトリを検索",
		});
		const crumbs = page.getByRole("navigation", {
			name: "コンテキストの階層",
		});
		await expect(
			page.getByRole("button", { name: "上の階層へ戻る" }),
		).toHaveCount(0);
		await search.fill("missing");
		await search.press(key);
		await expect(crumbs.getByRole("listitem")).toHaveCount(3);
		await expect(search).toHaveValue("");
		await expect(search).toBeFocused();
		await search.press(key);
		await expect(crumbs.getByRole("listitem")).toHaveCount(2);
		await crumbs
			.getByRole("button", { name: "コンテキストを追加", exact: true })
			.focus();
		await page.keyboard.press(key);
		await expect(crumbs.getByRole("listitem")).toHaveCount(1);
		const rootSearch = page.getByRole("combobox", {
			name: "コンテキストを検索",
		});
		await rootSearch.press("Alt+ArrowLeft");
		await expect(rootSearch).toBeVisible();
		await rootSearch.press("Escape");
		await expect(page.getByRole("listbox")).toHaveCount(0);
		await expect(input).toBeFocused();
		await expect(input).toHaveText("#");
	});
}

test("パンくずから祖先フォルダー・カテゴリ・入口へ戻る", async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 320, height: 820 });
	await openStory(
		page,
		"/iframe.html?id=chat-composer-menu--ready&viewMode=story",
	);
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await input.fill("#");
	await page
		.getByRole("option", { name: "ファイルとディレクトリ", exact: true })
		.click();
	await page.getByRole("option", { name: /project\// }).click();
	await page.getByRole("option", { name: /src\// }).click();
	const crumbs = page.getByRole("navigation", { name: "コンテキストの階層" });
	await expect(crumbs.getByRole("listitem")).toHaveText([
		"コンテキストを追加",
		"ファイルとディレクトリ",
		"project",
		"src",
	]);
	await expect(crumbs.locator('[aria-current="location"]')).toHaveText("src");
	await info.attach("breadcrumbs", {
		body: await page.screenshot({
			path: info.outputPath("breadcrumbs.png"),
		}),
		contentType: "image/png",
	});
	await page
		.getByRole("combobox", { name: "ファイルとディレクトリを検索" })
		.fill("missing");
	await crumbs.getByRole("button", { name: "project", exact: true }).click();
	await expect(page.getByRole("option", { name: /src\// })).toBeVisible();
	await expect(crumbs.getByRole("listitem")).toHaveCount(3);
	await crumbs
		.getByRole("button", { name: "ファイルとディレクトリ", exact: true })
		.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("option", { name: /project\// })).toBeVisible();
	await expect(crumbs.getByRole("listitem")).toHaveCount(2);
	await crumbs
		.getByRole("button", { name: "コンテキストを追加", exact: true })
		.click();
	await expect(
		page.getByRole("option", { name: "シンボル", exact: true }),
	).toBeVisible();
	await expect(crumbs.getByRole("listitem")).toHaveCount(1);
	await expect(input).toHaveText("#");
});

for (const colorScheme of ["dark", "light"] as const) {
	test(`共通ピッカーの挿入・最近使用・添付: ${colorScheme}`, async ({
		page,
	}, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 420, height: 820 });
		await page.emulateMedia({ colorScheme });
		await page.goto(
			`/iframe.html?id=chat-composer-menu--ready&viewMode=story&globals=theme:${colorScheme === "light" ? "light" : "dark2026"}`,
		);
		const input = page.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		const trigger = page.getByRole("button", {
			name: "コンテキストを追加",
			exact: true,
		});
		await input.fill("前文後文");
		await input.press("Home");
		await input.press("ArrowRight");
		await input.press("ArrowRight");
		await trigger.click();
		const search = page.getByRole("combobox", {
			name: "コンテキストを検索",
		});
		await expect(search).toBeFocused();
		await expect(page.getByRole("option")).toHaveCount(6);
		await page
			.getByRole("option", { name: "ハンドオフ", exact: true })
			.hover();
		await expect(
			page.getByRole("tooltip", {
				name: /セッション内容を要約し引き継ぐ/,
			}),
		).toHaveCSS("opacity", "1");
		await info.attach("category-tooltip", {
			body: await page.screenshot({
				path: info.outputPath("category-tooltip.png"),
			}),
			contentType: "image/png",
		});
		await page.mouse.move(0, 0);
		await expect(input).toHaveText("前文後文");
		await info.attach("plus-categories", {
			body: await page.screenshot({
				path: info.outputPath("plus-categories.png"),
			}),
			contentType: "image/png",
		});
		await search.fill("sess");
		await expect(page.getByRole("option")).toHaveCount(2);
		await expect(
			page.getByRole("option", { name: "ハンドオフ", exact: true }),
		).toBeVisible();
		await search.fill("file");
		await search.press("ArrowDown");
		await search.press("Enter");
		const files = page.getByRole("combobox", {
			name: "ファイルとディレクトリを検索",
		});
		await files.fill("alpha");
		await files.press("Enter");
		await expect(input).toHaveText("前文alpha.ts 後文");
		await expect(input).toBeFocused();
		await input.press("Control+z");
		await expect(input).toHaveText("前文後文");
		await input.fill("#sess");
		await expect(page.getByRole("option")).toHaveCount(2);
		await input.press("Escape");
		await expect(input).toHaveText("#sess");
		await trigger.focus();
		await trigger.press("Enter");
		await expect(search).toBeFocused();
		await search.press("Escape");
		await expect(page.getByRole("listbox")).toHaveCount(0);
		await expect(input).toHaveText("#sess");
		await input.fill("#");
		await page
			.getByRole("button", { name: "alpha.ts", exact: true })
			.click();
		await expect(input).toHaveText("alpha.ts");
		await expect(input.locator(".inline-path-reference")).toHaveCount(1);
		await trigger.click();
		await page.setViewportSize({ width: 320, height: 820 });
		await page
			.getByRole("button", { name: "alpha.ts", exact: true })
			.hover();
		await expect(page.getByRole("tooltip", { name: /alpha.ts/ })).toHaveCSS(
			"opacity",
			"1",
		);
		await info.attach("recent-narrow", {
			body: await page.screenshot({
				path: info.outputPath("recent-narrow.png"),
			}),
			contentType: "image/png",
		});
		await search.press("Escape");
		await expect(input).toBeFocused();
		await trigger.click();
		await page
			.getByRole("option", { name: "添付ファイル", exact: true })
			.click();
		await expectSent(page, { type: "attachment/add" });
		await expect(input).toHaveText("alpha.ts");
		await expect(page.getByRole("listbox")).toHaveCount(0);
		expect(errors).toEqual([]);
	});
}

test("添付が使えない状態でも参照を選択でき、外側クリックで閉じる", async ({
	page,
}) => {
	await openStory(
		page,
		"/iframe.html?id=chat-composer-menu--ready&viewMode=story",
	);
	await showState(page, { attachmentsSupported: false });
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await page
		.getByRole("button", { name: "コンテキストを追加", exact: true })
		.click();
	await expect(
		page.getByRole("option", { name: "添付ファイル", exact: true }),
	).toHaveAttribute("aria-disabled", "true");
	const search = page.getByRole("combobox", { name: "コンテキストを検索" });
	await search.press("Enter");
	expect(
		(await sentMessages(page)).filter(
			(message) => message.type === "attachment/add",
		),
	).toHaveLength(0);
	await search.press("ArrowDown");
	await search.press("Enter");
	await page.getByRole("option", { name: /alpha.ts/ }).click();
	await expect(input).toHaveText("alpha.ts");
	await page
		.getByRole("button", { name: "コンテキストを追加", exact: true })
		.click();
	await page.getByRole("heading", { name: "新規チャット" }).click();
	await expect(page.getByRole("listbox")).toHaveCount(0);
	await expect(input).toHaveText("alpha.ts");
});
