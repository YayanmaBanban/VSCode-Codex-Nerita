// バックエンドの選択・配置・キーボード操作を明暗と狭幅で確認する。
import { test, expect } from "@playwright/test";

test("Piでは認証管理の上にバックエンドを表示する", async ({ page }, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {errors.push(message.text());}
	});
	await page.setViewportSize({ width: 320, height: 760 });
	await page.goto("/iframe.html?id=chat-header--pi-backend&viewMode=story");
	await page.getByRole("button", { name: "オプション" }).click();
	const items = await page.getByRole("menuitem").allTextContents();
	expect(items.indexOf("バックエンド")).toBe(
		items.indexOf("認証情報を管理") - 1,
	);
	await page
		.getByRole("menuitem", { name: "バックエンド", exact: true })
		.click();
	await expect(
		page.getByRole("menuitemradio", { name: "Pi", exact: true }),
	).toBeChecked();
	await info.attach("pi-account-menu", {
		body: await page.screenshot({
			path: info.outputPath("pi-account.png"),
		}),
		contentType: "image/png",
	});
	expect(errors).toEqual([]);
});

for (const colorScheme of ["dark", "light"] as const) {
	for (const width of [320, 900]) {
		test(`バックエンド選択: ${colorScheme} ${width}`, async ({
			page,
		}, info) => {
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("console", (message) => {
				if (message.type() === "error") {errors.push(message.text());}
			});
			await page.setViewportSize({ width, height: 760 });
			await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
			await page.goto(
				"/iframe.html?id=chat-header--reconnect&viewMode=story",
			);
			const options = page.getByRole("button", { name: "オプション" });
			await options.click();
			const trigger = page.getByRole("menuitem", {
				name: "バックエンド",
				exact: true,
			});
			const items = await page.getByRole("menuitem").allTextContents();
			expect(items.indexOf("バックエンド")).toBeLessThan(
				items.indexOf("性格設定"),
			);
			await trigger.focus();
			await page.keyboard.press("ArrowRight");
			const codex = page.getByRole("menuitemradio", {
				name: "Codex",
				exact: true,
			});
			const pi = page.getByRole("menuitemradio", {
				name: "Pi",
				exact: true,
			});
			await expect(codex).toBeChecked();
			await info.attach("codex-selected", {
				body: await page.screenshot({
					path: info.outputPath("codex.png"),
				}),
				contentType: "image/png",
			});
			await pi.click();
			await options.click();
			await trigger.hover();
			await expect(pi).toBeChecked();
			await expect(codex).not.toBeChecked();
			await info.attach("pi-selected", {
				body: await page.screenshot({
					path: info.outputPath("pi.png"),
				}),
				contentType: "image/png",
			});
			await codex.click();
			await options.click();
			await trigger.click();
			await expect(codex).toBeChecked();
			await page.keyboard.press("Escape");
			await page.keyboard.press("Escape");
			await expect(options).toBeFocused();
			expect(errors).toEqual([]);
		});
	}
}
