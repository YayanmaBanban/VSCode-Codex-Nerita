// 一つの編集領域で貼り付け・コード編集・境界移動・履歴・送信を検証する。
import { test, expect } from "@playwright/test";

import { select, paste } from "./composerHelpers";

for (const colorScheme of ["dark", "light"] as const) {
	test(`単一フィールド・編集・矢印移動・送信: ${colorScheme}`, async ({
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
		await page.goto("/iframe.html?id=chat-app--empty&viewMode=story");
		const input = page.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		const code = input.locator("pre");
		const long = Array.from(
			{ length: 80 },
			(_, index) => `const sample${index} = '貼り付け内容';`,
		).join("\n");
		await input.fill("前文置換対象後文");
		await select(input, 2, 6);
		await paste(input, long);
		await expect(code).toHaveText(long, { useInnerText: true });
		await expect(input.locator("p").first()).toHaveText("前文");
		await expect(input.locator("p").last()).toHaveText("後文");
		await expect(page.locator("[contenteditable=true]")).toHaveCount(1);
		await expect(page.locator("textarea")).toHaveCount(0);
		await code.evaluate((node) => {
			node.scrollTop = 90;
		});
		expect(await code.evaluate((node) => node.scrollTop)).toBe(90);
		expect(await input.evaluate((node) => node.scrollTop)).toBe(0);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		await page.screenshot({
			path: info.outputPath(`lexical-${colorScheme}.png`),
		});
		await select(input.locator("p").first(), 2);
		await input.press("ArrowDown");
		expect(
			await page.evaluate(
				() =>
					window
						.getSelection()
						?.anchorNode?.parentElement?.closest("pre") !== null,
			),
		).toBe(true);
		await input.press("ArrowUp");
		expect(
			await page.evaluate(
				() =>
					window
						.getSelection()
						?.anchorNode?.parentElement?.closest("p")?.textContent,
			),
		).toBe("前文");
		await select(code, 0);
		await input.press("Home");
		await input.press("Enter");
		await page.keyboard.insertText("編集");
		await expect(code).toContainText("編集");
		await expect(page.getByRole("log")).toBeEmpty();
		await select(code, 0);
		await input.press("ArrowUp");
		expect(
			await page.evaluate(
				() =>
					window
						.getSelection()
						?.anchorNode?.parentElement?.closest("p")?.textContent,
			),
		).toBe("前文");
		await select(code, Number.MAX_SAFE_INTEGER);
		await input.press("ArrowDown");
		expect(
			await page.evaluate(
				() =>
					window
						.getSelection()
						?.anchorNode?.parentElement?.closest("p")?.textContent,
			),
		).toBe("後文");
		const expected = `前文${await code.innerText()}後文`;
		await input.press("Control+Enter");
		await expect(page.locator(".message.user")).toHaveText(expected);
		await expect(input).toHaveText("");
		await expect(input).toBeFocused();
		expect(errors).toEqual([]);
	});
}

test("短文ペースト・Undo/Redo・複数ブロック・全選択削除", async ({ page }) => {
	await page.goto("/iframe.html?id=chat-app--empty&viewMode=story");
	const input = page.getByRole("textbox");
	await input.fill("前後");
	await select(input, 1);
	await paste(input, "短文");
	await expect(input).toHaveText("前短文後");
	await select(input, 3);
	await paste(input, "const a = 1;");
	await expect(input.locator("pre")).toHaveCount(1);
	await input.press("Control+z");
	await expect(input.locator("pre")).toHaveCount(0);
	await expect(input).toHaveText("前短文後");
	await input.press("Control+Shift+z");
	await expect(input.locator("pre")).toHaveCount(1);
	await select(input.locator("p").last(), 0);
	await paste(input, "const b = 2;");
	await expect(input.locator("pre")).toHaveCount(2);
	// ブロック内への再ペーストは入れ子を作らず、コードの本文として挿入する。
	await select(input.locator("pre").last(), 0);
	await paste(input, "const c = 3;");
	await expect(input.locator("pre")).toHaveCount(2);
	await expect(input.locator("pre").last()).toHaveText(
		"const c = 3;const b = 2;",
	);
	await input.press("Control+a");
	await input.press("Backspace");
	await expect(input).toHaveText("");
	await expect(input.locator("pre")).toHaveCount(0);
});

test("全体の文字数制限", async ({ page }) => {
	await page.goto("/iframe.html?id=chat-app--empty&viewMode=story");
	const input = page.getByRole("textbox");
	await input.fill("前後");
	await select(input, 1);
	await paste(input, "a".repeat(99_999));
	await expect(page.getByRole("alert")).toContainText("100,000文字");
	await expect(input).toHaveText("前後");
	await paste(input, "a".repeat(99_998));
	await expect(input.locator("pre")).toHaveCount(0);
	await page.keyboard.insertText("超過");
	await expect(page.getByRole("alert")).toContainText("100,000文字");
	await expect
		.poll(async () => (await input.textContent())?.length)
		.toBe(100_000);
});

test("コード判定と通常テキストの5行境界", async ({ page }, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	await page.goto("/iframe.html?id=chat-app--empty&viewMode=story");
	const input = page.getByRole("textbox");
	const samples: [string, boolean][] = [
		["通常の文章です。".repeat(200), false],
		["一行目\n二行目\n三行目\n四行目\n", false],
		["URL: https://example.com/path?q=1", false],
		["説明（補足）: {名前} を指定してください。", false],
		["const value = 1;", true],
		['console.log("hello");', true],
		['print("hello")', true],
		["def greet():\n    return 'hello'", true],
		['import { value } from "./module";', true],
		['{"enabled": true}', true],
		["<div>hello</div>", true],
		["```\nhello\n```", true],
		["一行目\r\n二行目\r\n三行目\r\n四行目\r\n五行目", true],
	];
	for (const [text, block] of samples) {
		await input.fill("");
		await paste(input, text);
		await expect(input.locator("pre"), text).toHaveCount(block ? 1 : 0);
		if (block) {
			await expect(input.locator("pre")).toHaveText(
				text.replace(/\r\n/g, "\n"),
				{
					useInnerText: true,
				},
			);
		}
	}
	await info.attach("five-line-text-block", {
		body: await page.screenshot({
			path: info.outputPath("five-line-text.png"),
		}),
		contentType: "image/png",
	});
	expect(errors).toEqual([]);
});
