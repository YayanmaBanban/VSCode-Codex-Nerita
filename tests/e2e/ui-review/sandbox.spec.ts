// 共通Sandbox選択を両backend・明暗・狭幅で確認する。
import { test, expect } from "@playwright/test";

for (const backend of ["reconnect", "pi-backend"]) {
	for (const colorScheme of ["dark", "light"] as const) {
		test(`Sandbox ${backend} ${colorScheme}`, async ({ page }, info) => {
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("console", (message) => {
				if (message.type() === "error") {
					errors.push(message.text());
				}
			});
			await page.setViewportSize({ width: 320, height: 760 });
			await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
			await page.goto(
				`/iframe.html?id=chat-header--${backend}&viewMode=story`,
			);
			const options = page.getByRole("button", { name: "オプション" });
			await options.click();
			const trigger = page.getByRole("menuitem", {
				name: "サンドボックス",
				exact: true,
			});
			await trigger.focus();
			await page.keyboard.press("ArrowRight");
			await expect(
				page.getByRole("menuitemradio", {
					name: "elevated（標準）",
					exact: true,
				}),
			).toBeChecked();
			await page
				.getByRole("menuitemradio", {
					name: "unelevated（管理者権限なし）",
					exact: true,
				})
				.click();
			await options.click();
			await trigger.hover();
			await expect(
				page.getByRole("menuitemradio", {
					name: "unelevated（管理者権限なし）",
					exact: true,
				}),
			).toBeChecked();
			await info.attach("sandbox-selected", {
				body: await page.screenshot({
					path: info.outputPath("sandbox.png"),
				}),
				contentType: "image/png",
			});
			await page.keyboard.press("Escape");
			await page.keyboard.press("Escape");
			await expect(options).toBeFocused();
			expect(errors).toEqual([]);
		});
	}
}
