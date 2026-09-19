// ファイル・URIのドロップ、重複、無効状態を実際の入力欄で確認する。
import { test, expect } from "@playwright/test";

for (const colorScheme of ["dark", "light"] as const) {
	test(`ファイルのドロップ添付: ${colorScheme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 900 });
		await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
		await page.goto(
			"/iframe.html?id=chat-composer-settings--connected&viewMode=story",
		);
		const input = page.getByRole("textbox");
		await input.fill("この添付を確認してください");
		const transfer = await page.evaluateHandle(() => {
			const data = new DataTransfer();
			data.items.add(
				new File(["日本語の内容"], "日本語.txt", {
					type: "text/plain",
				}),
			);
			data.items.add(
				new File(
					[
						Uint8Array.from(
							atob(
								"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
							),
							(char) => char.charCodeAt(0),
						),
					],
					"image.png",
					{ type: "image/png" },
				),
			);
			return data;
		});
		await input.dispatchEvent("dragenter", { dataTransfer: transfer });
		await expect(
			page.getByText("ドロップしてファイルを添付"),
		).toBeVisible();
		await info.attach("drop-hover", {
			body: await page.screenshot({
				path: info.outputPath("hover.png"),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		await input.dispatchEvent("drop", { dataTransfer: transfer });
		await expect(
			page.getByRole("button", { name: "日本語.txt を開く" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "image.png を開く" }),
		).toBeVisible();
		await expect(input).toHaveText("この添付を確認してください");
		await expect(page.getByText("ドロップしてファイルを添付")).toHaveCount(
			0,
		);
		await input.dispatchEvent("drop", { dataTransfer: transfer });
		await expect(page.locator(".attachment")).toHaveCount(2);
		const uri = await page.evaluateHandle(() => {
			const data = new DataTransfer();
			data.setData(
				"text/uri-list",
				"# comment\r\nfile:///D:/workspace/settings.ts",
			);
			return data;
		});
		await input.dispatchEvent("drop", { dataTransfer: uri });
		await expect(
			page.getByRole("button", { name: "settings.ts を開く" }),
		).toBeVisible();
		const codeFiles = await page.evaluateHandle(() => {
			const data = new DataTransfer();
			data.setData(
				"CodeFiles",
				JSON.stringify(["D:\\workspace\\コード.ts"]),
			);
			return data;
		});
		await input.dispatchEvent("drop", { dataTransfer: codeFiles });
		await expect(
			page.getByRole("button", { name: "コード.ts を開く" }),
		).toBeVisible();
		await expect(page.locator(".attachment")).toHaveCount(4);
		await info.attach("attached", {
			body: await page.screenshot({
				path: info.outputPath("attached.png"),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		await page
			.getByRole("button", { name: "settings.ts を取り外す" })
			.click();
		await expect(page.locator(".attachment")).toHaveCount(3);
		await page.getByRole("button", { name: "切断通知" }).click();
		await input.dispatchEvent("drop", { dataTransfer: uri });
		await expect(page.locator(".attachment")).toHaveCount(3);
		expect(errors).toEqual([]);
	});
}
