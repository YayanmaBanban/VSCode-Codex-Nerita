// 認証先の検索・展開・キー入力・OAuth・取消を明暗と幅別に検証する。
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	for (const width of [320, 900]) {
		test(`認証エディター ${theme} ${width}`, async ({ page }, info) => {
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("console", (message) => {
				if (message.type() === "error") {
					errors.push(message.text());
				}
			});
			await page.setViewportSize({ width, height: 850 });
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(
				"/iframe.html?id=chat-piautheditor--providers&viewMode=story",
			);
			await expect(page.getByRole("listitem")).toHaveCount(3);
			await expect(page.getByLabel("設定済み")).toHaveCount(1);
			await page.getByRole("button", { name: /Anthropic/ }).click();
			await expect(
				page.getByRole("button", { name: /Anthropic/ }),
			).toHaveAttribute("aria-expanded", "true");
			await info.attach("providers", {
				body: await page.screenshot({
					path: info.outputPath("providers.png"),
				}),
				contentType: "image/png",
			});
			await page
				.getByRole("searchbox", { name: "認証先を検索" })
				.fill("openai");
			await expect(page.getByRole("listitem")).toHaveCount(1);
			await page
				.getByRole("button", { name: "OpenAI", exact: true })
				.click();
			await page.getByRole("button", { name: "APIキーを設定" }).click();
			await expect(
				page.getByLabel("APIキーを入力してください"),
			).toHaveAttribute("type", "password");
			await info.attach("key-input", {
				body: await page.screenshot({
					path: info.outputPath("input.png"),
				}),
				contentType: "image/png",
			});
			await page
				.getByLabel("APIキーを入力してください")
				.fill("test-only-key");
			await page
				.getByRole("button", { name: "送信", exact: true })
				.click();
			await expect(
				page.getByLabel("APIキーを入力してください"),
			).toHaveCount(0);
			await expect(page.getByLabel("設定済み")).toHaveCount(1);
			const originalButtonY = (await page
				.getByRole("button", { name: "OAuthでログイン" })
				.boundingBox())!.y;
			await expect(
				page.locator("#provider-openai").getByRole("status"),
			).toHaveText("認証情報を更新しました。");
			await page.getByRole("button", { name: "OAuthでログイン" }).click();
			await expect(
				page.getByLabel("確認コードを入力してください"),
			).toBeVisible();
			await page
				.getByRole("button", { name: "認証をキャンセル" })
				.click();
			await expect(page.getByRole("alert")).toHaveText(
				"認証をキャンセルしました。",
			);
			await expect(
				page.getByLabel("確認コードを入力してください"),
			).toHaveCount(0);
			await expect
				.poll(
					async () =>
						(await page
							.getByRole("button", { name: "OAuthでログイン" })
							.boundingBox())!.y,
				)
				.toBe(originalButtonY);
			await info.attach("provider-error", {
				body: await page.screenshot({
					path: info.outputPath("error.png"),
				}),
				contentType: "image/png",
			});
			await page.getByRole("searchbox").fill("google");
			await page
				.getByRole("button", { name: "Google", exact: true })
				.click();
			await expect(page.getByRole("alert")).toHaveCount(0);
			await page.getByRole("searchbox").fill("openai");
			await page.getByRole("button", { name: /OpenAI/ }).click();
			await expect(
				page.locator("#provider-openai").getByRole("alert"),
			).toHaveText("認証をキャンセルしました。");
			await page.getByRole("searchbox").fill("no-match");
			await expect(
				page.getByText("一致する認証先がありません。"),
			).toBeVisible();
			expect(errors).toEqual([]);
		});
	}
}
