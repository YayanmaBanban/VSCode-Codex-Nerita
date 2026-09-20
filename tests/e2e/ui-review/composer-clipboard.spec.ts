// コピー・カットの参照情報を貼り付けで復元し、外部向け本文も保持する。
import { test, expect, type Locator } from "@playwright/test";
import { select } from "./composerHelpers";

test("実際のクリップボードでもCtrl+C・Ctrl+X・Ctrl+Vでチップを復元する", async ({
	page,
}) => {
	await page
		.context()
		.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.goto(
		"/iframe.html?id=chat-composer-references--restored&viewMode=story",
	);
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await expect(input.locator(".inline-path-reference")).toHaveCount(2);
	await input.press("Control+a");
	await page.keyboard.press("Control+c");
	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toBe(
			'前文"D:\\workspace\\日本語 sample.md" と D:\\workspace\\src 後文',
		);
	await page.keyboard.press("Backspace");
	await expect(input).toHaveText("");
	await page.keyboard.press("Control+v");
	await expect(input.locator(".inline-path-reference")).toHaveCount(2);
	await page.keyboard.press("Control+a");
	await page.keyboard.press("Control+x");
	await expect(input).toHaveText("");
	await page.keyboard.press("Control+v");
	await expect(input.locator(".inline-path-reference")).toHaveCount(2);
	await expect(input).toHaveText("前文日本語 sample.md と src 後文");
});

/** ブラウザのコピー・カットイベントで全クリップボード形式を採取する。 */
async function copy(input: Locator, operation: "copy" | "cut") {
	return input.evaluate((node, type) => {
		const clipboardData = new DataTransfer();
		node.dispatchEvent(
			new ClipboardEvent(type, {
				clipboardData,
				bubbles: true,
				cancelable: true,
			}),
		);
		return Object.fromEntries(
			clipboardData.types.map((format) => [
				format,
				clipboardData.getData(format),
			]),
		);
	}, operation);
}

/** コピー元が提供した形式をそのまま貼り付け先へ渡す。 */
async function paste(input: Locator, formats: Record<string, string>) {
	await input.evaluate((node, value) => {
		const clipboardData = new DataTransfer();
		for (const [format, text] of Object.entries(value)) {
			clipboardData.setData(format, text);
		}
		node.dispatchEvent(
			new ClipboardEvent("paste", {
				clipboardData,
				bubbles: true,
				cancelable: true,
			}),
		);
	}, formats);
}

for (const operation of ["copy", "cut"] as const) {
	test(`${operation}した本文と複数チップを別の入力欄へ復元する`, async ({
		page,
	}, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(
			"/iframe.html?id=chat-composer-references--restored&viewMode=story",
		);
		let input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
		await expect(input.locator(".inline-path-reference")).toHaveCount(2);
		await input.press("Control+a");
		const formats = await copy(input, operation);
		expect(
			formats["application/x-codex-composer-references+json"],
		).toBeTruthy();
		expect(formats["text/plain"]).toBe(
			'前文"D:\\workspace\\日本語 sample.md" と D:\\workspace\\src 後文',
		);
		if (operation === "cut") {
			await expect(input).toHaveText("");
			await input.press("Control+z");
			await expect(input.locator(".inline-path-reference")).toHaveCount(
				2,
			);
		}
		await page.goto(
			"/iframe.html?id=chat-composer-menu--ready&viewMode=story",
		);
		input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
		await input.fill("前後");
		await select(input.locator("p > span[data-lexical-text]").first(), 1);
		await paste(input, formats);
		await expect(input.locator(".inline-path-reference")).toHaveCount(2);
		await expect(input).toHaveText("前前文日本語 sample.md と src 後文後");
		await page.screenshot({
			path: info.outputPath(`${operation}-restored.png`),
		});
		await input.press("Control+z");
		await expect(input).toHaveText("前後");
		await input.press("Control+y");
		await expect(input.locator(".inline-path-reference")).toHaveCount(2);
		await input.press("Control+Enter");
		await expect(page.locator(".message.user")).toContainText(
			`前${formats["text/plain"]}後`,
		);
		expect(errors).toEqual([]);
	});
}

test("逆向きに選択したチップだけを復元し、通常テキストはチップ化しない", async ({
	page,
}) => {
	await page.goto(
		"/iframe.html?id=chat-composer-references--restored&viewMode=story",
	);
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await expect(input.locator(".inline-path-reference")).toHaveCount(2);
	await select(input.locator("p > span[data-lexical-text]").nth(1), 0);
	await page.keyboard.press("Shift+ArrowLeft");
	const formats = await copy(input, "copy");
	expect(formats["text/plain"]).toBe('"D:\\workspace\\日本語 sample.md"');
	await input.press("Control+a");
	await paste(input, formats);
	await expect(input.locator(".inline-path-reference")).toHaveCount(1);
	await expect(input).toHaveText("日本語 sample.md");
	await input.press("Control+a");
	await paste(input, { "text/plain": formats["text/plain"]! });
	await expect(input.locator(".inline-path-reference")).toHaveCount(0);
	await expect(input).toHaveText(formats["text/plain"]!);
});
