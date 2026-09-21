// Markdownの構造・安全な表示・コピー・狭幅での表示を実ブラウザーで検証する。
import { test, expect } from "@playwright/test";

for (const colorScheme of ["dark", "light"] as const) {
	test(`Markdown本文とツールJSON: ${colorScheme}`, async ({
		page,
		context,
	}, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await context.grantPermissions(["clipboard-read", "clipboard-write"]);
		await page.setViewportSize({ width: 320, height: 820 });
		await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
		await page.goto(
			"/iframe.html?id=chat-markdown--preview&viewMode=story",
		);
		const answer = page.locator(".message.assistant");
		await expect(
			answer.getByRole("heading", { name: "変更内容" }),
		).toBeVisible();
		await expect(answer.locator("strong")).toHaveText("太字");
		await expect(answer.locator("ul ul li")).toHaveText("子項目");
		await expect(answer.locator("ol > li")).toHaveCount(2);
		await expect(answer.locator("blockquote")).toContainText(
			"引用した説明",
		);
		await expect(answer.locator("del")).toHaveText("取り消し");
		await expect(answer.getByRole("checkbox").first()).toBeChecked();
		await expect(answer.getByRole("checkbox").first()).toBeDisabled();
		await expect(
			answer.getByRole("cell", { name: "対応済み" }),
		).toBeVisible();
		await expect(
			answer.getByRole("link", { name: "ドキュメント" }),
		).toHaveAttribute("href", "https://example.com/docs");
		await expect(
			answer.locator("a").filter({ hasText: "無効なリンク" }),
		).not.toHaveAttribute("href", /javascript:/);
		for (const [name, uri] of [
			[
				"Code-Implementation.md",
				"file:///D:/User/Desktop/vscode-codex-acp/.agents/docs/Code-Implementation.md",
			],
			["AGENTS.md", "file:///D:/User/Desktop/vscode-codex-acp/AGENTS.md"],
			[
				"日本語",
				"file:///D:/workspace/%E6%97%A5%E6%9C%AC%E8%AA%9E%20sample.md",
			],
		]) {
			const link = answer.getByRole("link", { name, exact: true });
			await expect(link).toHaveAttribute("href", uri!);
			await link.click();
			await expect(page.getByLabel("開いたファイル")).toHaveText(uri!);
			await link.focus();
			await page.keyboard.press("Enter");
			await expect(page.getByLabel("開いたファイル")).toHaveText(uri!);
		}
		await expect(
			answer.locator("a").filter({ hasText: "コマンド" }),
		).not.toHaveAttribute("href");
		await expect(answer.locator("script, b")).toHaveCount(0);
		await expect(answer).toContainText("<b>HTMLは文字列</b>");
		await expect(answer.locator("pre code")).toContainText(
			"<strong>文字列</strong>",
		);
		await expect(page.locator(".message.user strong")).toHaveText(
			"Markdown",
		);
		await expect(page.locator(".tool-body pre")).toContainText(
			"**これはJSONのまま**",
		);
		await expect(page.locator(".tool-body strong")).toHaveCount(0);
		await answer.getByRole("button", { name: "回答をコピー" }).click();
		const copied = await page.evaluate(() =>
			navigator.clipboard.readText(),
		);
		expect(copied).toContain("## 変更内容");
		expect(copied).toContain("**太字**");
		expect(copied).toContain("```ts");
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		await page.screenshot({
			path: info.outputPath(`markdown-${colorScheme}.png`),
			fullPage: true,
		});
		await page.getByRole("button", { name: "途中の本文" }).click();
		await expect(answer.locator("pre code")).toHaveText(
			"const partial = true;\n",
		);
		await page
			.getByRole("button", { name: "本文完了", exact: true })
			.click();
		await expect(answer.locator(".text-type")).toHaveCount(0);
		await expect(
			answer.getByRole("heading", { name: "変更内容" }),
		).toBeVisible();
		expect(errors).toEqual([]);
	});
}
