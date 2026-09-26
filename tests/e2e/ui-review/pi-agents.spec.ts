// 子の閲覧中も承認先を区別して回答し、全体停止と親への復帰を確認する。
import { test, expect } from "@playwright/test";

for (const colorScheme of ["dark", "light"] as const) {
	for (const width of [320, 1100]) {
		test(`Piの子の承認と停止: ${colorScheme} ${width}`, async ({
			page,
		}, info) => {
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("console", (message) => {
				if (message.type() === "error") {
					errors.push(message.text());
				}
			});
			await page.setViewportSize({ width, height: 900 });
			await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
			await page.goto(
				"/iframe.html?id=chat-pi-agents--parallel&viewMode=story",
			);
			await page
				.getByRole("button", {
					name: "reviewer 1の会話を表示 · 実行中",
				})
				.click();
			const controls = page.getByRole("complementary", {
				name: "親と子の実行操作",
			});
			await expect(
				page.getByText("検査を進めています。", { exact: true }),
			).toBeVisible();
			await expect(
				controls.getByText("APIの検査", { exact: true }),
			).toBeVisible();
			await controls
				.getByRole("button", { name: "今回のみ許可", exact: true })
				.first()
				.click();
			await expect(
				controls.getByRole("button", {
					name: "今回のみ許可",
					exact: true,
				}),
			).toHaveCount(1);
			await expect(
				controls.getByText("画面の検査", { exact: true }),
			).toBeVisible();
			await page.screenshot({
				path: info.outputPath("child-approval.png"),
				fullPage: true,
			});
			await controls.getByRole("button", { name: "すべて停止" }).click();
			await expect(controls).toBeHidden();
			await page.getByRole("button", { name: "親へ戻る" }).click();
			await expect(
				page.getByRole("button", {
					name: "reviewer 1の会話を表示 · 停止",
				}),
			).toBeVisible();
			await expect(
				page.getByRole("button", {
					name: "reviewer 2の会話を表示 · 停止",
				}),
			).toBeVisible();
			await expect(page.locator("body")).toHaveJSProperty(
				"scrollWidth",
				width,
			);
			await page.screenshot({
				path: info.outputPath("parent-stopped.png"),
				fullPage: true,
			});
			expect(errors).toEqual([]);
		});
	}
}
