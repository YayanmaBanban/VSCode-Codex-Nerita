// Piの履歴復元・失敗・継続送信を、明暗テーマと狭幅で確認する。
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	test(`Pi履歴の復元と継続: ${theme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 900 });
		await page.emulateMedia({ colorScheme: theme });
		await page.goto("/iframe.html?id=chat-app--pi-history&viewMode=story");
		await page
			.getByRole("button", { name: "セッション一覧", exact: true })
			.click();
		const panel = page.getByRole("complementary", {
			name: "セッション一覧",
		});
		await expect(panel.getByRole("listitem")).toHaveCount(2);
		await expect.poll(async () => (await panel.boundingBox())?.x).toBe(0);
		await expect(
			panel.getByRole("button", { name: /名前を変更/ }).first(),
		).toBeDisabled();
		await info.attach("history-list", {
			body: await page.screenshot({ path: info.outputPath("list.png") }),
			contentType: "image/png",
		});
		await panel
			.getByRole("button", {
				name: "Piの設定ファイルを確認した会話を開く",
			})
			.click();
		await expect(
			panel.getByRole("button", {
				name: "Piの設定ファイルを確認した会話を開く",
			}),
		).toHaveAttribute("aria-current", "true");
		await panel
			.getByRole("button", { name: "削除された履歴ファイルを開く" })
			.click();
		await expect(panel.getByRole("alert")).toContainText(
			"Piの履歴が見つかりません",
		);
		await info.attach("history-error", {
			body: await page.screenshot({ path: info.outputPath("error.png") }),
			contentType: "image/png",
		});
		await panel
			.getByRole("button", { name: "再試行", exact: true })
			.click();
		await expect(panel.getByRole("alert")).toHaveCount(0);
		await panel
			.getByRole("button", { name: "セッション一覧を閉じる" })
			.click();
		await expect(page.locator("#session-panel")).toHaveCount(0);
		await expect(
			page.getByText("保存した会話を復元しました。", { exact: true }),
		).toBeVisible();
		const read = page.locator('.tool-card[data-kind="read"]');
		await read.getByRole("button").click();
		await expect(read).toContainText('"enabled": true');
		await expect(
			page.locator('.tool-card[data-kind="edit"]'),
		).toHaveAttribute("data-status", "cancelled");
		await expect(
			page.getByRole("region", { name: "承認要求" }),
		).toHaveCount(0);
		await info.attach("history-restored", {
			body: await page.screenshot({
				path: info.outputPath("restored.png"),
			}),
			contentType: "image/png",
		});
		await page.getByRole("textbox").fill("続きをお願いします");
		await page.getByRole("button", { name: "送信", exact: true }).click();
		await expect(page.getByText(/作業が完了しました/)).toBeVisible();
		await expect(read).toHaveCount(1);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		expect(errors).toEqual([]);
	});
}
