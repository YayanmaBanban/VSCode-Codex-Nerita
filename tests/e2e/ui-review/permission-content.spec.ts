// コマンド全文を保持しながら、狭い画面でも承認操作に到達できることを確認する。
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	test(`承認の長いコマンドと詳細 ${theme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 1100 });
		await page.emulateMedia({
			colorScheme: theme,
			reducedMotion: "reduce",
		});
		await page.goto(
			"/iframe.html?id=chat-permission--long-command&viewMode=story",
		);
		const approval = page.getByRole("region", { name: "承認要求" });
		const command = approval.getByLabel("コマンド", { exact: true });
		await expect(command).toBeVisible();
		await expect(command).toContainText("20:");
		expect(
			await command.evaluate(
				(node) =>
					node.scrollHeight > node.clientHeight &&
					node.scrollWidth > node.clientWidth,
			),
		).toBe(true);
		await expect(
			approval.getByRole("button", { name: "今回のみ許可" }),
		).toBeInViewport();
		await command.focus();
		await command.press("Control+End");
		await expect
			.poll(() => command.evaluate((node) => node.scrollTop))
			.toBeGreaterThan(0);
		await command.evaluate((node) => {
			node.scrollTop = 0;
		});
		const summary = approval.locator("summary");
		await summary.focus();
		await summary.press("Enter");
		await expect(approval.getByLabel("実行argv")).toBeVisible();
		await expect(
			approval
				.locator("dt")
				.filter({ hasText: "制限時間" })
				.locator("+ dd"),
		).toHaveText("10000 ms");
		await info.attach("expanded", {
			body: await page.screenshot({
				path: info.outputPath("expanded.png"),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		await summary.press("Enter");
		await expect(approval.getByLabel("実行argv")).not.toBeVisible();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		await info.attach("collapsed", {
			body: await page.screenshot({
				path: info.outputPath("collapsed.png"),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		expect(errors).toEqual([]);
	});
}
