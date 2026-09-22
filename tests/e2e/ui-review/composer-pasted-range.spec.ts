// 行番号付きパスを貼り付け、範囲を指定した開く要求と送信本文を確認する。
import { test, expect } from "@playwright/test";
import { paste } from "./composerHelpers";

for (const colorScheme of ["dark", "light"] as const) {
	test(`行範囲付きパスの貼り付けとクリック: ${colorScheme}`, async ({
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
			"/iframe.html?id=chat-composer-symbols--search&viewMode=story",
		);
		const input = page.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		await input.fill("#");
		await paste(
			input,
			"D:/workspace/project/src/ComposerInput.tsx:1:3-101:5",
		);
		await expect(input.locator(".inline-path-reference")).toHaveText(
			"ComposerInput.tsx(0:100)",
		);
		await input
			.getByRole("button", {
				name: "ComposerInput.tsx を開く",
				exact: true,
			})
			.click();
		const opened: unknown = JSON.parse(
			(await page.getByLabel("開いた参照").textContent())!,
		);
		expect(opened).toMatchObject({
			type: "reference/open",
			range: {
				start: { line: 0, character: 2 },
				end: { line: 100, character: 4 },
			},
		});
		await info.attach("range-chip", {
			body: await page.screenshot({
				path: info.outputPath("range-chip.png"),
			}),
			contentType: "image/png",
		});
		await input.press("Control+End");
		await input.press("Control+Enter");
		await expect(page.locator(".message.user")).toContainText(
			"ComposerInput.tsx:1:3-101:5",
		);
		expect(errors).toEqual([]);
	});
}
