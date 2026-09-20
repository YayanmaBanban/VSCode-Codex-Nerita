// 専用本文・アイコンと、画像リンクが既存のHost通信を使うことを検証する。
import { test, expect } from "@playwright/test";

for (const colorScheme of ["dark", "light"] as const) {
	test(`専用ツールの表示と画像リンク: ${colorScheme}`, async ({
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
		await page.setViewportSize({ width: 320, height: 900 });
		await page.goto(
			"/iframe.html?id=chat-activity-tools--all&viewMode=story",
		);
		await expect(page.locator(".message-markdown strong")).toHaveText([
			"Implementing file move mapping",
			"Moving files with mappings",
		]);
		for (const icon of ["image", "plug-zap", "shelving-unit"]) {
			await expect(page.locator(`.lucide-${icon}`)).toHaveCount(1);
		}
		await expect(page.locator(".lucide-signal")).toHaveCount(3);
		for (const title of ["server / tool", "コンテキスト圧縮"]) {
			const card = page.locator(".tool-card").filter({ hasText: title });
			await expect(
				card.locator("button, .tool-body, .tool-chevron"),
			).toHaveCount(0);
		}
		await expect(
			page.getByRole("link", { name: "React scroll & resize" }),
		).toHaveAttribute(
			"href",
			"https://www.google.com/search?q=React%20scroll%20%26%20resize",
		);
		await expect(
			page.getByRole("link", {
				name: "https://example.com/page?q=1",
				exact: true,
			}),
		).toHaveAttribute("href", "https://example.com/page?q=1");
		await expect(
			page.getByRole("link", {
				name: "https://example.com/normalized",
				exact: true,
			}),
		).toHaveAttribute("href", "https://example.com/normalized");
		await page
			.getByRole("link", {
				name: "D:\\workspace\\画像 #1.png",
				exact: true,
			})
			.click();
		await expect(page.getByLabel("送信した要求")).toContainText(
			'"type":"reference/open"',
		);
		await expect(page.getByLabel("送信した要求")).toContainText(
			"file:///D:/workspace/%E7%94%BB%E5%83%8F%20%231.png",
		);
		await page
			.getByRole("link", { name: "images/preview.png", exact: true })
			.focus();
		await page.keyboard.press("Enter");
		await expect(page.getByLabel("送信した要求")).toContainText(
			"file:///D:/workspace/images/preview.png",
		);
		await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 320);
		await info.attach("activity-tools", {
			body: await page.screenshot({
				fullPage: true,
				path: info.outputPath("activity-tools.png"),
			}),
			contentType: "image/png",
		});
		expect(errors).toEqual([]);
	});
}
