// チップと添付一覧の開く操作を、本文編集・送信から分離して確認する。
import { test, expect } from "@playwright/test";
import { paste, select } from "./composerHelpers";

test("入力URLを編集し、修飾クリックで開いてそのまま送信できる", async ({
	page,
}, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	await page.goto(
		"/iframe.html?id=chat-composer-settings--connected&viewMode=story",
	);
	await page.evaluate(() => {
		window.open = () => {
			throw new Error("WebviewのリンクはVS Codeのクリック処理へ渡す");
		};
		// VS Code の `preload` と同様に、`defaultPrevented` でも伝播したリンクを処理する。
		window.addEventListener("click", (event) => {
			if (!event.isTrusted) {
				return;
			}
			for (const node of event.composedPath()) {
				if (node instanceof HTMLAnchorElement && node.href) {
					document.body.dataset.openedUrl = node.href;
					event.preventDefault();
					return;
				}
			}
		});
	});
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await input.fill("確認 https://example.com/docs");
	const link = input.getByRole("link", { name: "https://example.com/docs" });
	await expect(link).toHaveAttribute("href", "https://example.com/docs");
	await link.click();
	await expect(page.locator("body")).not.toHaveAttribute("data-opened-url");
	await link.click({ modifiers: ["Control"] });
	await expect(page.locator("body")).toHaveAttribute(
		"data-opened-url",
		"https://example.com/docs",
	);
	await expect(input).toHaveText("確認 https://example.com/docs");
	await select(
		input,
		"確認 https://example.com/".length,
		"確認 https://example.com/docs".length,
	);
	await page.keyboard.insertText("guide");
	await expect(input.getByRole("link")).toHaveAttribute(
		"href",
		"https://example.com/guide",
	);
	await input.getByRole("link").click({ modifiers: ["Control"] });
	await expect(page.locator("body")).toHaveAttribute(
		"data-opened-url",
		"https://example.com/guide",
	);
	await expect(page.locator(".message.user")).toHaveCount(0);
	await page.screenshot({ path: info.outputPath("composer-url.png") });
	await select(input, "確認 https://example.com/guide".length);
	await paste(input, " と www.example.org/path");
	await expect(input.getByRole("link")).toHaveCount(2);
	await expect(
		input.getByRole("link", { name: "www.example.org/path" }),
	).toHaveAttribute("href", "https://www.example.org/path");
	await input.press("Control+Enter");
	await expect(page.locator(".message.user")).toContainText(
		"確認 https://example.com/guide と www.example.org/path",
	);
	await expect(input).toHaveText("");
	expect(errors).toEqual([]);
});

test("コード内のURLは文字列として保持し、URLでなくなった入力はリンクを解除する", async ({
	page,
}, info) => {
	await page.goto(
		"/iframe.html?id=chat-composer-settings--connected&viewMode=story",
	);
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await input.fill("https://example.com");
	await expect(input.getByRole("link")).toHaveCount(1);
	await select(input, 0, 8);
	await page.keyboard.press("Backspace");
	await expect(input).toHaveText("example.com");
	await expect(input.getByRole("link")).toHaveCount(0);
	await input.press("Control+z");
	await expect(input.getByRole("link")).toHaveCount(1);
	await input.fill("");
	await paste(input, 'const url = "https://example.com";');
	await expect(input.locator("pre")).toHaveText(
		'const url = "https://example.com";',
	);
	await expect(input.getByRole("link")).toHaveCount(0);
	await page.screenshot({ path: info.outputPath("composer-code-url.png") });
});

test("ファイルとフォルダのチップをマウスとキーボードで開く", async ({
	page,
}, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(
		"/iframe.html?id=chat-composer-references--restored&viewMode=story",
	);
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await input
		.getByRole("button", { name: "日本語 sample.md を開く" })
		.click();
	await expect(page.getByLabel("開いた参照")).toHaveText(
		"file:///D:/workspace/日本語%20sample.md",
	);
	const folder = input.getByRole("button", { name: "src をExplorerで表示" });
	await folder.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByLabel("開いた参照")).toHaveText(
		"file:///D:/workspace/src",
	);
	await expect(input).toHaveText("前文日本語 sample.md と src 後文");
	await expect(page.locator(".message.user")).toHaveCount(0);
	await page.screenshot({ path: info.outputPath("open-folder-focus.png") });
	await input.getByRole("button", { name: "src の参照を取り外す" }).click();
	await expect(input.locator(".inline-path-reference")).toHaveCount(1);
	await expect(page.getByLabel("開いた参照")).toHaveText(
		"file:///D:/workspace/src",
	);
	expect(errors).toEqual([]);
});

test("添付画像を一覧と本文のチップから開ける", async ({ page }, info) => {
	await page.goto(
		"/iframe.html?id=chat-composer-settings--connected&viewMode=story",
	);
	await page.getByRole("button", { name: "ファイルを添付" }).click();
	await page
		.locator(".attachments")
		.getByRole("button", { name: "design.png を開く" })
		.click();
	await expect(page.getByLabel("最後の要求")).toContainText(
		'"type":"attachment/open"',
	);
	await expect(page.getByLabel("最後の要求")).toContainText(
		'"attachmentId":"image"',
	);
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await input.fill("#");
	await input.press("Enter");
	await page.getByRole("option", { name: /design.png/ }).click();
	await input.getByRole("button", { name: "design.png を開く" }).click();
	await expect(page.getByLabel("最後の要求")).toContainText(
		'"type":"reference/open"',
	);
	await expect(page.getByLabel("最後の要求")).toContainText(
		'"uri":"file:///workspace/design.png"',
	);
	await expect(input).toHaveText("design.png");
	await expect(page.locator(".message.user")).toHaveCount(0);
	await page.screenshot({ path: info.outputPath("open-attachment.png") });
});
