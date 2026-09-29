// 専用本文・アイコンと、画像リンクが既存の Host 通信を使うことを検証する。
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
			`/iframe.html?id=chat-activity-tools--all&viewMode=story&globals=theme:${colorScheme === "light" ? "light" : "dark2026"}`,
		);
		await expect(page.locator(".message-markdown strong")).toHaveText([
			"Implementing file move mapping",
			"Moving files with mappings",
		]);
		const think = page.locator('.combo-list-card[data-kind="think"]');
		const heading = think.getByRole("button");
		const collapse = think.locator(".combo-list-collapse");
		await heading.click();
		await expect(heading).toHaveAttribute("aria-expanded", "false");
		await expect(collapse).toHaveCSS("visibility", "hidden");
		await heading.press("Enter");
		await expect(heading).toHaveAttribute("aria-expanded", "true");
		await think.evaluate((element) => {
			for (const animation of element.getAnimations({ subtree: true })) {
				animation.pause();
				animation.currentTime = 0;
			}
		});
		for (const time of [0, 50, 110, 180, 220]) {
			await think.evaluate((element, time) => {
				for (const animation of element.getAnimations({
					subtree: true,
				})) {
					animation.currentTime = time;
				}
			}, time);
			await page.screenshot({
				path: info.outputPath(`think-opening-${time}.png`),
			});
		}
		await expect(collapse).toHaveCSS("opacity", "1");
		for (const title of [
			"画像を確認",
			"Web検索（検索語）",
			"Web検索（URL）",
			"Web検索（正規化後）",
		]) {
			const card = page
				.locator(".combo-list-card")
				.filter({
					has: page.getByRole("button", {
						name: `${title} 実行中`,
						exact: true,
					}),
				});
			const toggle = card.getByRole("button");
			await toggle.click();
			await expect(toggle).toHaveAttribute("aria-expanded", "false");
			await expect(card.getByRole("link").first()).not.toBeVisible();
			await toggle.press("Enter");
			await expect(toggle).toHaveAttribute("aria-expanded", "true");
			await expect(card.getByRole("link").first()).toBeVisible();
		}
		await page.emulateMedia({ reducedMotion: "reduce" });
		await heading.click();
		await expect(collapse).toHaveCSS("visibility", "hidden");
		await heading.press("Space");
		await expect(collapse).toHaveCSS("opacity", "1");
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
