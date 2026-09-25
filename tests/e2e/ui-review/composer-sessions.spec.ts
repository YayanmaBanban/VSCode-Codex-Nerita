// セッション候補・復元・クリップボードと送信する参照 ID を確認する。
import { test, expect } from "@playwright/test";

for (const colorScheme of ["dark", "light"] as const) {
	test(`セッションを選択して内容を開きコピー後も参照を送信: ${colorScheme}`, async ({
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
			"/iframe.html?id=chat-composer-sessions--references&viewMode=story",
		);
		const input = page.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		await input.fill("#");
		await page
			.getByRole("option", { name: "セッション", exact: true })
			.click();
		await expect(page.getByRole("option", { name: /UI設計/ })).toHaveCount(
			2,
		);
		await info.attach("session-candidates", {
			body: await page.screenshot({
				path: info.outputPath(`sessions-${colorScheme}.png`),
			}),
			contentType: "image/png",
		});
		await page.getByRole("option", { name: /さらに読み込む/ }).click();
		await page.getByRole("option", { name: /入力欄の実装/ }).click();
		await expect(input.locator(".inline-path-reference")).toHaveCount(1);
		await input.getByRole("button", { name: /の内容を表示/ }).click();
		await expect(page.getByLabel("表示したセッション")).toHaveText(
			"saved-input",
		);
		await input.press("Control+a");
		await page.keyboard.press("Control+x");
		await expect(input).toHaveText("");
		await page.keyboard.press("Control+v");
		await expect(input.locator(".inline-path-reference")).toHaveCount(1);
		await page
			.getByRole("button", { name: "エディタグループへ移動" })
			.click();
		await expect(input.locator(".inline-path-reference")).toHaveCount(1);
		await input.getByRole("button", { name: /の内容を表示/ }).focus();
		await page.keyboard.press("Enter");
		await expect(page.locator(".message.user")).toHaveCount(0);
		await info.attach("session-chip", {
			body: await page.screenshot({
				path: info.outputPath(`session-chip-${colorScheme}.png`),
			}),
			contentType: "image/png",
		});
		await input.press("End");
		await input.press("Control+Enter");
		await expect(page.getByLabel("送信した参照")).toContainText(
			'"referencedSessionIds":["saved-input"]',
		);
		await expect(page.locator(".message.user")).toContainText(
			"ID: saved-input",
		);
		expect(errors).toEqual([]);
	});
}

test("検索・失敗・再送・取り外しを行い参照解除後はIDを送らない", async ({
	page,
}, info) => {
	await page.goto(
		"/iframe.html?id=chat-composer-sessions--references&viewMode=story",
	);
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await input.fill("この方針で #");
	await page.getByRole("option", { name: "セッション", exact: true }).click();
	const search = page.getByRole("combobox", { name: "セッションを検索" });
	await search.fill("ない会話");
	await expect(page.getByRole("listbox")).toContainText(
		"参照できるセッションがありません",
	);
	await search.fill("error");
	await expect(page.getByRole("listbox")).toContainText(
		"検索できませんでした",
	);
	await search.fill("UI設計");
	await expect(page.getByRole("option")).toHaveCount(2);
	await search.press("ArrowDown");
	await search.press("Enter");
	await expect(input).toHaveText("この方針で UI設計");
	await page.getByRole("button", { name: "次の送信を失敗" }).click();
	await input.press("End");
	await input.press("Control+Enter");
	await expect(
		page.getByText(
			"参照セッションを読み込めませんでした。参照を外して再送してください。",
			{ exact: true },
		),
	).toBeVisible();
	await expect(input.locator(".inline-path-reference")).toHaveCount(1);
	await expect(input).toHaveAttribute("aria-disabled", "false");
	await page.screenshot({ path: info.outputPath("session-send-failed.png") });
	await input
		.getByRole("button", { name: "UI設計 の参照を取り外す" })
		.click();
	await input.press("Control+Enter");
	await expect(page.getByLabel("送信した参照")).not.toContainText(
		"referencedSessionIds",
	);
	await expect(page.locator(".message.user")).toHaveText("この方針で");
});

test("ページ送り後に検索語を戻しても先頭ページから表示する", async ({
	page,
}) => {
	await page.goto(
		"/iframe.html?id=chat-composer-sessions--references&viewMode=story",
	);
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await input.fill("#");
	await page.getByRole("option", { name: "セッション", exact: true }).click();
	await page.getByRole("option", { name: "さらに読み込む" }).click();
	await expect(
		page.getByRole("option", { name: /入力欄の実装/ }),
	).toBeVisible();
	const search = page.getByRole("combobox", { name: "セッションを検索" });
	await search.fill("UI設計");
	await expect(page.getByRole("option")).toHaveCount(2);
	await search.fill("");
	await expect(
		page.getByRole("option", { name: "さらに読み込む" }),
	).toBeVisible();
	await expect(
		page.getByRole("option", { name: /入力欄の実装/ }),
	).toHaveCount(0);
});
