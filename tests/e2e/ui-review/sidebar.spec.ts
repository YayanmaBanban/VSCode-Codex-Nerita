// 配置選択のホバー待機・チェック・移動後の入力維持を検証する。
import { test, expect } from "@playwright/test";

for (const colorScheme of ["dark", "light"] as const) {
	test(`サイドバーの選択と300msホバー: ${colorScheme}`, async ({
		page,
	}, info) => {
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
			"/iframe.html?id=chat-header--long-title&viewMode=story",
		);
		await page.getByRole("textbox").fill("移動しても残る下書き");
		await page
			.getByRole("button", { name: "エディタグループへ移動" })
			.click();
		await page.getByRole("button", { name: "オプション" }).click();
		const trigger = page.getByRole("menuitem", {
			name: "サイドバー",
			exact: true,
		});
		await expect(page.getByRole("menuitem").first()).toHaveText(
			"サイドバー",
		);
		await page.clock.install();
		await page.clock.pauseAt(new Date());
		await trigger.hover();
		await page.clock.runFor(200);
		const primary = page.getByRole("menuitemradio", {
			name: "プライマリ",
			exact: true,
		});
		const secondary = page.getByRole("menuitemradio", {
			name: "セカンダリ",
			exact: true,
		});
		await expect(primary).toBeHidden();
		await page.clock.runFor(150);
		await expect(primary).toBeVisible();
		await expect(secondary).toBeChecked();
		await expect(secondary.locator("svg")).toHaveCSS(
			"color",
			"rgb(76, 175, 120)",
		);
		await info.attach("secondary-selected", {
			body: await page.screenshot({
				path: info.outputPath("secondary.png"),
			}),
			contentType: "image/png",
		});
		await page.clock.resume();
		await primary.click();
		await expect(
			page.getByRole("button", { name: "エディタグループへ移動" }),
		).toBeVisible();
		await expect(page.getByRole("textbox")).toHaveText(
			"移動しても残る下書き",
		);
		await page.getByRole("button", { name: "オプション" }).click();
		await trigger.focus();
		await page.keyboard.press("ArrowRight");
		await expect(primary).toBeChecked();
		await expect(secondary).not.toBeChecked();
		await info.attach("primary-selected", {
			body: await page.screenshot({
				path: info.outputPath("primary.png"),
			}),
			contentType: "image/png",
		});
		await secondary.click();
		await page.getByRole("button", { name: "オプション" }).click();
		await trigger.click();
		await expect(secondary).toBeChecked();
		await page.keyboard.press("Escape");
		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("button", { name: "オプション" }),
		).toBeFocused();
		expect(errors).toEqual([]);
	});
}
