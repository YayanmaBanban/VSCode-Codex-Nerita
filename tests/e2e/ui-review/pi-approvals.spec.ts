// Piの承認カードと完了・拒否・停止を明暗・狭幅で操作して撮影する。
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	for (const choice of ["今回のみ許可", "拒否", "ターンを中止", "停止"]) {
		test(`Pi承認 ${theme} ${choice}`, async ({ page }, info) => {
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("console", (message) => {
				if (message.type() === "error") {
					errors.push(message.text());
				}
			});
			await page.setViewportSize({ width: 320, height: 820 });
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(
				"/iframe.html?id=chat-app--pi-approvals&viewMode=story",
			);
			for (const tool of ["write", "powershell"]) {
				await page.getByRole("textbox").fill(tool);
				await page
					.getByRole("button", { name: "送信", exact: true })
					.click();
				const approval = page.getByRole("region", { name: "承認要求" });
				await expect(approval).toContainText(`Pi: ${tool}`);
				await expect(approval).toContainText(
					"D:/workspace with spaces/project",
				);
				await approval.scrollIntoViewIfNeeded();
				await expect(approval).toContainText("書込み許可:");
				if (tool === "powershell") {
					await expect(approval).toContainText("実行範囲: Sandbox");
					await expect(approval).toContainText("Shell network: 禁止");
				}
				await info.attach(`${tool}-pending`, {
					body: await page.screenshot({ fullPage: true }),
					contentType: "image/png",
				});
				if (choice === "停止") {
					await page
						.getByRole("button", { name: "停止", exact: true })
						.click();
				} else {
					await approval
						.getByRole("button", { name: choice, exact: true })
						.click();
				}
				await expect(approval).toHaveCount(0);
				if (choice === "今回のみ許可") {
					await page
						.locator(".tool-card")
						.last()
						.getByRole("button", { expanded: false })
						.click();
					await expect(
						page.locator(".tool-card").last(),
					).toContainText("操作が完了しました。");
				} else if (choice === "拒否") {
					await expect(
						page.locator(".tool-card").last(),
					).toContainText("操作は実行されていません。");
				} else {
					await expect(
						page.getByText("停止しました", { exact: true }),
					).toBeVisible();
				}
				await info.attach(`${tool}-resolved`, {
					body: await page.screenshot({ fullPage: true }),
					contentType: "image/png",
				});
				expect(
					await page.evaluate(
						() =>
							document.documentElement.scrollWidth <=
							window.innerWidth,
					),
				).toBe(true);
			}
			expect(errors).toEqual([]);
		});
	}
}
