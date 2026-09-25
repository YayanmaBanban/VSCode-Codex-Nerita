// Pi の承認カードと完了・拒否・停止を明暗・狭幅で操作して撮影する。
import { test, expect, type Locator } from "@playwright/test";

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
			for (const tool of ["write", "powershell", "pwsh", "bash"]) {
				await page.getByRole("textbox").fill(tool);
				await page
					.getByRole("button", { name: "送信", exact: true })
					.click();
				const approval = page.getByRole("region", { name: "承認要求" });
				await expect(approval).toContainText(`Pi: ${tool}`);
				await expect(approval).toContainText(
					"workspace with spaces/project",
				);
				await approval.scrollIntoViewIfNeeded();
				await expectExecutionScope(approval, tool);
				await expect(approval.getByRole("heading")).toHaveText(
					`Pi: ${tool} の実行承認`,
				);
				await approval.screenshot({
					path: info.outputPath(`${tool}-collapsed.png`),
				});
				if (tool === "powershell" || tool === "pwsh") {
					const details = approval.locator("details");
					await expect(details).not.toHaveAttribute("open", "");
					await details.locator("summary").focus();
					await details.locator("summary").press("Enter");
					await expect(details).toHaveAttribute("open", "");
					const argv = details.getByLabel("実行argv");
					await expect(argv).toBeVisible();
					await expect(argv).toContainText(`${tool}.exe`);
					await argv.focus();
					await argv.press("End");
					await expect
						.poll(() => argv.evaluate((node) => node.scrollTop))
						.toBeGreaterThan(0);
					await argv.evaluate((node) => {
						node.scrollTop = 0;
					});
					await approval.screenshot({
						path: info.outputPath(`${tool}-expanded.png`),
					});
				}
				if (tool === "powershell") {
					for (const target of [
						"$OutputEncoding",
						"[Console]::InputEncoding",
						"[Console]::OutputEncoding",
					]) {
						await expect(approval).toContainText(
							`${target} = [System.Text.Encoding]::UTF8`,
						);
					}
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
					if (tool === "powershell") {
						await expect(
							page.locator(".tool-card").last(),
						).toContainText("UTF-8 was not applied");
					}
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

/** OS ごとのシェル表示と Host ファイル操作の表示を区別する。 */
async function expectExecutionScope(approval: Locator, tool: string) {
	if (tool === "bash") {
		await expect(approval).toContainText("Pi Shell（OSの権限で実行）");
		await expect(approval).not.toContainText("Sandbox");
		return;
	}
	await expect(approval).toContainText("書込み許可");
	if (tool === "write") {
		await expect(approval).toContainText("HostファイルTool（Sandbox外）");
		return;
	}
	await expect(
		approval
			.locator("dt")
			.filter({ hasText: "Shell network設定" })
			.locator("+ dd"),
	).toHaveText("無効");
	await expect(approval).toContainText("Shell Sandbox");
}
