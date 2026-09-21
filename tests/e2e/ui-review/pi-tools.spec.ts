// Piの読み取りカードを明暗・狭幅で操作し、停止後の継続と失敗表示を確認する。
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	test(`Piのread・ls・停止・継続会話: ${theme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.emulateMedia({ colorScheme: theme });
		await page.setViewportSize({ width: 320, height: 900 });
		await page.goto("/iframe.html?id=chat-app--pi-tools&viewMode=story");
		await page.getByRole("textbox").fill("ファイルを確認");
		await page.getByRole("button", { name: "送信", exact: true }).click();
		const read = page.locator('.tool-card[data-kind="read"]');
		const list = page.locator('.tool-card[data-kind="list"]');
		await expect(read).toHaveAttribute("data-status", "in_progress");
		await expect(
			read.getByText("結果を待っています。", { exact: true }),
		).toBeVisible();
		await expect(read).toContainText("開始行: 1");
		await list.getByRole("button").click();
		await expect(list.locator("pre")).toHaveText(
			"extension/\nshared/\nwebview/",
		);
		await info.attach("running", {
			body: await page.screenshot({
				path: info.outputPath("pi-tools-running.png"),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		await page.getByRole("button", { name: "停止", exact: true }).click();
		await expect(read).toHaveAttribute("data-status", "cancelled");
		await expect(read.getByText("停止", { exact: true })).toBeVisible();
		await expect(read.getByRole("img", { name: "失敗" })).toHaveCount(0);
		await expect(list).toHaveAttribute("data-status", "completed");
		await info.attach("stopped", {
			body: await page.screenshot({
				path: info.outputPath("pi-tools-stopped.png"),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		await page.getByRole("textbox").fill("続けてください");
		await page.getByRole("button", { name: "送信", exact: true }).click();
		await expect(read).toHaveCount(2);
		await expect(read.last()).toHaveAttribute("data-status", "completed");
		await expect(read.first()).toHaveAttribute("data-status", "cancelled");
		await expect(read.last().getByRole("button")).toHaveAttribute(
			"aria-expanded",
			"false",
		);
		await read.last().getByRole("button").focus();
		await page.keyboard.press("Enter");
		await expect(read.last().locator("pre")).toContainText(
			"<script>これはファイルの内容です</script>",
		);
		await expect(read.last().locator("script")).toHaveCount(0);
		await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 320);
		await info.attach("completed", {
			body: await page.screenshot({
				path: info.outputPath("pi-tools-completed.png"),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		await page.getByRole("textbox").fill("missingを確認");
		await page.getByRole("button", { name: "送信", exact: true }).click();
		await expect(read).toHaveCount(3);
		await expect(read.last()).toHaveAttribute("data-status", "failed");
		await expect(
			read.last().getByRole("img", { name: "失敗" }),
		).toBeVisible();
		await expect(read.last().locator("pre")).toContainText("ENOENT");
		await info.attach("failed", {
			body: await page.screenshot({
				path: info.outputPath("pi-tools-failed.png"),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		await page.getByRole("button", { name: "新しいチャット" }).click();
		await expect(page.locator(".tool-card")).toHaveCount(0);
		await expect(page.getByRole("log")).toBeEmpty();
		await info.attach("browser-errors", {
			body: JSON.stringify(errors),
			contentType: "application/json",
		});
		expect(errors).toEqual([]);
	});
}
