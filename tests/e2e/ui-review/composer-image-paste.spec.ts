// 画像ペーストの添付・容量制限と通常テキストへの影響を確認する。
import { test, expect } from "@playwright/test";
import { paste } from "./composerHelpers";

for (const colorScheme of ["dark", "light"] as const) {
	test(`クリップボード画像の添付: ${colorScheme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
		await page.goto(
			"/iframe.html?id=chat-composer-settings--connected&viewMode=story",
		);
		const input = page.getByRole("textbox");
		await input.fill("この画像を確認してください");
		await input.evaluate((element) => {
			const data = new DataTransfer();
			const bytes = Uint8Array.from(
				atob(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
				),
				(char) => char.charCodeAt(0),
			);
			data.items.add(
				new File([bytes], "image.png", { type: "image/png" }),
			);
			data.items.add(
				new File([bytes], "second.png", { type: "image/png" }),
			);
			data.setData("text/plain", "画像のコピー元");
			data.setData("text/uri-list", "file:///D:/unrelated.png");
			element.dispatchEvent(
				new ClipboardEvent("paste", {
					clipboardData: data,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		await expect(
			page.getByRole("button", { name: "image.png を開く", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "second.png を開く" }),
		).toBeVisible();
		await expect(page.locator(".attachment")).toHaveCount(2);
		await expect(input).toHaveText("この画像を確認してください");
		await input.press("Control+End");
		await paste(input, "通常テキスト");
		await expect(input).toContainText("通常テキスト");
		await page.screenshot({ path: info.outputPath("pasted-images.png") });
		await input.evaluate((element) => {
			const data = new DataTransfer();
			data.items.add(
				new File([new Uint8Array(20 * 1024 * 1024 + 1)], "large.png", {
					type: "image/png",
				}),
			);
			element.dispatchEvent(
				new ClipboardEvent("paste", {
					clipboardData: data,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		await expect(page.getByRole("alert")).toContainText("20MB");
		await expect(page.locator(".attachment")).toHaveCount(2);
		await page.getByRole("button", { name: "切断通知" }).click();
		await input.evaluate((element) => {
			const data = new DataTransfer();
			data.items.add(
				new File(["image"], "disabled.png", { type: "image/png" }),
			);
			element.dispatchEvent(
				new ClipboardEvent("paste", {
					clipboardData: data,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		await expect(page.locator(".attachment")).toHaveCount(2);
		expect(errors).toEqual([]);
	});
}
