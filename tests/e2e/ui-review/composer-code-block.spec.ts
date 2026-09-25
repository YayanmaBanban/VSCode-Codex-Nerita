// 標準メニューへ渡す条件と、Host 通知後の選択保持・変換・履歴を検証する。
import { test, expect, type Locator } from "@playwright/test";
import { select, paste } from "./composerHelpers";

/** OS のメニュー表示を伴わず、同じ `contextmenu` イベントを入力欄へ送る。 */
async function prepare(input: Locator, enabled: boolean) {
	await input.dispatchEvent("contextmenu", { bubbles: true });
	await expect(input).toHaveAttribute(
		"data-vscode-context",
		new RegExp(`"composerCanCodeBlock":${enabled}`),
	);
}

for (const colorScheme of ["dark", "light"] as const) {
	test(`選択をブロック化しUndo/Redoする: ${colorScheme}`, async ({
		page,
	}, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.emulateMedia({ colorScheme });
		await page.goto(
			"/iframe.html?id=chat-composer-code-block--selection&viewMode=story",
		);
		const input = page.getByRole("textbox");
		await select(input, 2, 8);
		await prepare(input, true);
		await page
			.getByRole("button", { name: "Hostのコードブロック化を通知" })
			.click();
		await expect(input.locator("pre")).toHaveText("選択する本文");
		await expect(input.locator("p").first()).toHaveText("前文");
		await expect(input.locator("p").last()).toHaveText("後文");
		await info.attach("converted-selection", {
			body: await page.screenshot({
				path: info.outputPath(`converted-${colorScheme}.png`),
			}),
			contentType: "image/png",
		});
		await input.press("Control+z");
		await expect(input).toHaveText("前文選択する本文後文");
		await expect(input.locator("pre")).toHaveCount(0);
		await input.press("Control+Shift+z");
		await expect(input.locator("pre")).toHaveText("選択する本文");
		await select(input.locator("pre"), 0, 2);
		await prepare(input, false);
		await select(input, 0, 9);
		await prepare(input, false);
		await input.fill("一行目\n二行目\n三行目");
		await select(input, 1, 10);
		await prepare(input, true);
		await page
			.getByRole("button", { name: "Hostのコードブロック化を通知" })
			.click();
		await expect(input.locator("pre")).toHaveText("行目\n二行目\n三行", {
			useInnerText: true,
		});
		expect(errors).toEqual([]);
	});
}

test("未選択・参照・ロック・変更済みの選択は変換しない", async ({ page }) => {
	await page.goto(
		"/iframe.html?id=chat-composer-code-block--selection&viewMode=story",
	);
	const input = page.getByRole("textbox");
	await select(input, 2);
	await prepare(input, false);
	await select(input, 2, 8);
	await prepare(input, true);
	await paste(input, "変更済み");
	await expect(input).toHaveAttribute(
		"data-vscode-context",
		/"composerCanCodeBlock":false/,
	);
	await page
		.getByRole("button", { name: "Hostのコードブロック化を通知" })
		.click();
	await expect(input.locator("pre")).toHaveCount(0);
	await page.getByRole("button", { name: "参照を含む下書き" }).click();
	await select(input, 0, 5);
	await prepare(input, false);
	await input.fill("通常の本文");
	await select(input, 0, 6);
	await prepare(input, true);
	await page.getByRole("button", { name: "入力ロック切替" }).click();
	await prepare(input, false);
});
