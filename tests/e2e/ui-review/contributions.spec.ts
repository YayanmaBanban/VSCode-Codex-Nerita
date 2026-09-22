// 同じRendererでprovider差分・操作・無効化を狭幅の明暗テーマで確認する。
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	test(`Contribution slots: ${theme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 650 });
		await page.emulateMedia({
			colorScheme: theme,
			reducedMotion: "reduce",
		});
		for (const story of [
			"codex-app-server",
			"pi-codex",
			"pi-anthropic",
			"pi-google",
			"pi-local",
		]) {
			await page.goto(
				`/iframe.html?id=chat-contributions--${story}&viewMode=story`,
			);
			await expect(
				page.locator(
					`[data-settings-surface="${story === "codex-app-server" ? "codex" : "pi"}"]`,
				),
			).toHaveCount(1);
			await expect(
				page.getByRole("combobox", { name: "Model", exact: true }),
			).toBeEnabled();
			await expect(
				page.getByRole("combobox", { name: "モデルヘッダーの拡張例" }),
			).toBeDisabled();
			await expect(
				page.getByRole("combobox", { name: "ツールバーの拡張例" }),
			).toBeDisabled();
			await expect(
				page.getByRole("switch", { name: "拡張設定の例" }),
			).toHaveCount(story === "pi-codex" ? 1 : 0);
			await expect(
				page.getByRole("progressbar", { name: "利用枠の表示例" }),
			).toHaveCount(story.includes("codex") ? 1 : 0);
			await info.attach(story, {
				body: await page.screenshot({
					path: info.outputPath(`${story}.png`),
					fullPage: true,
				}),
				contentType: "image/png",
			});
			expect(
				await page
					.locator("body")
					.evaluate((element) => element.scrollWidth),
			).toBe(320);
		}
		await page.goto(
			"/iframe.html?id=chat-contributions--pi-codex&viewMode=story",
		);
		await page.getByRole("switch", { name: "拡張設定の例" }).focus();
		await page.keyboard.press("Space");
		await expect(
			page.getByRole("switch", { name: "拡張設定の例" }),
		).toBeChecked();
		await expect(page.getByLabel("最後の要求")).toContainText(
			'"value":"on"',
		);
		await page
			.getByRole("combobox", { name: "Model", exact: true })
			.click();
		await page
			.getByRole("option", { name: "Anthropic Claude", exact: true })
			.click();
		await expect(page.getByRole("switch")).toHaveCount(0);
		await expect(
			page.getByRole("progressbar", { name: "利用枠の表示例" }),
		).toHaveCount(0);
		await expect(page.getByLabel("最後の要求")).toContainText(
			'"value":"anthropic/demo"',
		);
		await page.getByRole("button", { name: "実行状態を切替" }).click();
		await expect(
			page.getByRole("combobox", { name: "Model", exact: true }),
		).toBeDisabled();
		await page.getByRole("button", { name: "実行状態を切替" }).click();
		await expect(
			page.getByRole("combobox", { name: "Model", exact: true }),
		).toBeEnabled();
		await page.getByRole("button", { name: "切断", exact: true }).click();
		await expect(
			page.getByRole("combobox", { name: "Reasoning effort" }),
		).toBeDisabled();
		expect(errors).toEqual([]);
	});
}
