// 会話検索の条件・一致移動・ハイライトと、明暗テーマの狭い表示を検証する。
import { test, expect } from "@playwright/test";

for (const colorScheme of ["dark", "light"] as const) {
	test(`会話検索の条件とキーボード操作: ${colorScheme}`, async ({
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
		await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
		await page.goto("/iframe.html?id=chat-search--ready&viewMode=story");
		const composer = page.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		await composer.fill("下書きは検索対象に含めない");
		await composer.press("Control+f");
		const search = page.getByRole("search", { name: "会話内検索" });
		const input = search.getByRole("textbox", { name: "会話を検索" });
		const count = search.getByLabel("検索結果");
		await expect(input).toBeFocused();
		await input.fill("power");
		await expect(count).toHaveText("1/8");
		await expect
			.poll(() =>
				page.evaluate(
					() => CSS.highlights.get("chat-find-matches")?.size,
				),
			)
			.toBe(8);
		await page.screenshot({ path: info.outputPath("search-matches.png") });
		await input.press("Shift+Enter");
		await expect(count).toHaveText("8/8");
		await expect
			.poll(() =>
				page.evaluate(() => {
					const range = CSS.highlights
						.get("chat-find-current")
						?.values()
						.next().value;
					return range instanceof Range ? range.toString() : "";
				}),
			)
			.toBe("power");
		await input.press("Enter");
		await expect(count).toHaveText("1/8");
		await search
			.getByRole("button", { name: "大文字と小文字を区別" })
			.click();
		await expect(count).toHaveText("1/6");
		await search
			.getByRole("button", { name: "単語単位", exact: true })
			.click();
		await expect(count).toHaveText("1/4");
		await search
			.getByRole("button", { name: "大文字と小文字を区別" })
			.click();
		await expect(count).toHaveText("1/6");
		await search
			.getByRole("button", { name: "単語単位", exact: true })
			.click();
		await input.fill("power station");
		await expect(count).toHaveText("1/1");
		await expect
			.poll(() =>
				page.evaluate(() => {
					const range = CSS.highlights
						.get("chat-find-current")
						?.values()
						.next().value;
					return range instanceof Range ? range.toString() : "";
				}),
			)
			.toBe("power station");
		await input.fill("power\\[\\d\\]");
		await expect(count).toHaveText("0/0");
		await search
			.getByRole("button", { name: "正規表現", exact: true })
			.click();
		await expect(count).toHaveText("1/1");
		await page.screenshot({ path: info.outputPath("search-regex.png") });
		await input.fill("[");
		await expect(page.getByRole("alert")).toHaveText(
			"正規表現が正しくありません。",
		);
		await expect(
			search.getByRole("button", { name: "次の一致" }),
		).toBeDisabled();
		await page.screenshot({ path: info.outputPath("search-error.png") });
		await search
			.getByRole("button", { name: "正規表現", exact: true })
			.click();
		await input.fill("下書き");
		await expect(count).toHaveText("0/0");
		await input.fill("power station");
		await expect(count).toHaveText("1/1");
		await input.press("Escape");
		await expect(search).toHaveCount(0);
		await expect(composer).toBeFocused();
		await expect(composer).toHaveText("下書きは検索対象に含めない");
		await expect(
			page.locator(".message.assistant strong"),
		).toBeInViewport();
		expect(
			await page.evaluate(() => CSS.highlights.has("chat-find-matches")),
		).toBe(false);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		expect(errors).toEqual([]);
	});
}

test("検索中の追加メッセージと再表示・F3での一致移動", async ({ page }) => {
	await page.goto("/iframe.html?id=chat-search--ready&viewMode=story");
	const composer = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await composer.fill("追加した検索語");
	await composer.press("Control+f");
	const input = page.getByRole("textbox", { name: "会話を検索" });
	const count = page.getByLabel("検索結果");
	await input.fill("追加した検索語");
	await expect(count).toHaveText("0/0");
	await composer.press("Enter");
	await expect(count).toHaveText("1/1");
	await input.press("F3");
	await expect(page.locator(".message.user").last()).toBeInViewport();
	await input.fill("power");
	await expect(count).toHaveText("1/8");
	await input.press("F3");
	await expect(count).toHaveText("2/8");
	await input.press("Shift+F3");
	await expect(count).toHaveText("1/8");
	await input.press("Control+f");
	await expect(input).toBeFocused();
	expect(
		await input.evaluate((element) =>
			element instanceof HTMLInputElement
				? element.selectionEnd! - element.selectionStart!
				: 0,
		),
	).toBe(5);
	const toggle = page.getByRole("button", { name: "大文字と小文字を区別" });
	await toggle.focus();
	await toggle.press("Enter");
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	await expect(count).toHaveText("1/6");
	await page.getByRole("button", { name: "検索を閉じる" }).click();
	await composer.press("Control+f");
	await expect(input).toHaveValue("power");
	await expect(count).toHaveText("1/6");
});
