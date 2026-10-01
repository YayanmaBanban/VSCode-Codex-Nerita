// Pi の承認カードと完了・拒否・停止を明暗・狭幅で操作して撮影する。
import { openStory } from "../storyPage";
import { expectSent, showState } from "../storyBridge";
import { piApprovalState } from "../../../apps/nerita-ui/stories/chat/fixtures/piApproval";
import { test, expect, type Locator } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	// 操作4種と表示4種を代表条件で組み合わせ、同じ操作を全ツールで繰り返さない。
	for (const [tool, choice] of [
		["powershell", "今回のみ許可"],
		["write", "拒否"],
		["pwsh", "ターンを中止"],
		["bash", "停止"],
	] as const) {
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

			await openStory(
				page,
				`/iframe.html?id=chat-app--pi-approvals&viewMode=story&args=approvalTool:${tool}`,
			);
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
				// 詳細全体の撮影時だけ高さを広げ、内部スクロールによる見切れを避ける。
				await page.setViewportSize({ width: 320, height: 1600 });
				await approval.scrollIntoViewIfNeeded();
				await approval.screenshot({
					path: info.outputPath(`${tool}-expanded.png`),
				});
				await page.setViewportSize({ width: 320, height: 820 });
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
			await expectSent(
				page,
				choice === "停止"
					? { type: "prompt/cancel", runId: "pi-approval-run" }
					: {
							type: "permission/respond",
							optionId: {
								今回のみ許可: "accept",
								拒否: "decline",
								ターンを中止: "cancel",
							}[choice],
						},
			);
			// 承認の意味は Controller の担当。ここでは応答前の保持と指定状態の描画を確認する。
			await expect(approval).toBeVisible();
			const completed = choice === "今回のみ許可";
			const declined = choice === "拒否";
			const status = {
				今回のみ許可: "completed",
				拒否: "failed",
				ターンを中止: "cancelled",
				停止: "cancelled",
			} as const;
			await showState(page, {
				permissions: [],
				run: completed || declined ? "completed" : "cancelled",
				tools: piApprovalState(tool).tools!.map((item) => ({
					...item,
					status: status[choice],
					content: [
						{
							type: "content",
							content: {
								type: "text",
								text: completed
									? "操作が完了しました。"
									: "操作は実行されていません。",
							},
						},
					],
				})),
			});
			await expect(approval).toHaveCount(0);
			if (completed) {
				await page
					.locator(".tool-card")
					.last()
					.getByRole("button", { expanded: false })
					.click();
				await expect(page.locator(".tool-card").last()).toContainText(
					"操作が完了しました。",
				);
			} else if (declined) {
				await expect(page.locator(".tool-card").last()).toContainText(
					"操作は実行されていません。",
				);
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
