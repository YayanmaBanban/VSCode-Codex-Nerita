// 実Host設定を使うStoryで、Ultra・Fast Mode・provider差分を狭幅の明暗テーマで確認する。
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	test(`Pi provider controls: ${theme}`, async ({ page }, info) => {
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
		await page.goto(
			"/iframe.html?id=chat-pi-provider-controls--connected&viewMode=story",
		);
		const provider = page.getByRole("combobox", {
			name: "Provider",
			exact: true,
		});
		const reasoning = page.getByRole("combobox", {
			name: "Reasoning effort",
		});
		const fast = page.getByRole("switch", { name: "Fast mode" });
		await expect(provider).toBeEnabled({ timeout: 30000 });
		await expect(
			page.getByRole("combobox", { name: "Pi Model" }),
		).toHaveText("GPT-6-Astra");
		await page.getByRole("combobox", { name: "Pi Model" }).click();
		await expect(page.getByRole("option", { name: "Spark" })).toHaveCount(
			0,
		);
		await expect(
			page.getByRole("option", { name: "Hidden Codex" }),
		).toHaveCount(0);
		await page
			.getByRole("option", { name: "GPT-6-Astra", exact: true })
			.click();
		await reasoning.click();
		await expect(
			page.getByRole("option", { name: "off", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("option", { name: "minimal", exact: true }),
		).toHaveCount(0);
		await info.attach("live-reasoning", {
			body: await page.screenshot({
				path: info.outputPath("live-reasoning.png"),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		await page.getByRole("option", { name: "Ultra", exact: true }).click();
		await fast.focus();
		await page.keyboard.press("Space");
		await expect(fast).toBeChecked();
		await expect(reasoning).toHaveText("Ultra");
		await expect(page.getByLabel("実効設定")).toContainText(
			'"thinkingLevel":"max"',
		);
		await expect(
			page.getByRole("progressbar", {
				name: "利用枠の残量",
				exact: true,
			}),
		).toHaveAttribute("aria-valuenow", "68");
		await page.getByRole("progressbar", { name: "利用枠の残量" }).hover();
		await expect(page.getByRole("tooltip")).toContainText("5h: 68%");
		await expect(page.getByRole("tooltip")).toContainText("Weekly: 82%");
		await info.attach("ultra-fast-quota", {
			body: await page.screenshot({
				path: info.outputPath("ultra-fast-quota.png"),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		await fast.click();
		await expect(reasoning).toHaveText("Ultra");
		await page.getByRole("combobox", { name: "Pi Model" }).click();
		await page
			.getByRole("option", {
				name: "Codex Small",
				exact: true,
			})
			.click();
		await expect(fast).toHaveCount(0);
		await reasoning.click();
		await expect(
			page.getByRole("option", { name: "off", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("option", { name: "minimal", exact: true }),
		).toBeVisible();
		await info.attach("small-reasoning", {
			body: await page.screenshot({
				path: info.outputPath("small-reasoning.png"),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		await expect(
			page.getByRole("option", { name: "Ultra", exact: true }),
		).toHaveCount(0);
		await page.getByRole("option", { name: "high", exact: true }).click();
		for (const name of ["anthropic", "google", "local"]) {
			await provider.click();
			await page.getByRole("option", { name, exact: true }).click();
			await expect(fast).toHaveCount(0);
			await expect(
				page.getByRole("progressbar", { name: "利用枠の残量" }),
			).toHaveCount(0);
			await info.attach(name, {
				body: await page.screenshot({
					path: info.outputPath(`${name}.png`),
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
		await provider.click();
		await page
			.getByRole("option", { name: "openai-codex", exact: true })
			.click();
		await expect(fast).not.toBeChecked();
		await expect(reasoning).not.toHaveText("Ultra");
		await page.getByRole("button", { name: "実行状態を切替" }).click();
		await expect(provider).toBeDisabled();
		await expect(fast).toBeDisabled();
		await page.getByRole("button", { name: "実行状態を切替" }).click();
		await page.getByRole("button", { name: "利用枠取得失敗" }).click();
		await expect(
			page.getByRole("progressbar", { name: "利用枠の残量" }),
		).toHaveCount(0);
		await expect(provider).toBeEnabled();
		await page.getByRole("button", { name: "切断", exact: true }).click();
		await expect(provider).toBeDisabled();
		await page.goto(
			"/iframe.html?id=chat-pi-provider-controls--hidden-history&viewMode=story",
		);
		const model = page.getByRole("combobox", { name: "Pi Model" });
		await expect(model).toHaveText("GPT-6-Astra");
		await model.click();
		await expect(
			page.getByRole("option", { name: "GPT-6-Astra", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("option", { name: "Hidden Codex" }),
		).toHaveCount(0);
		await expect(page.getByRole("option", { name: "Spark" })).toHaveCount(
			0,
		);
		await info.attach("hidden-history", {
			body: await page.screenshot({
				path: info.outputPath("hidden-history.png"),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		await page.goto(
			"/iframe.html?id=chat-pi-provider-controls--no-metadata&viewMode=story",
		);
		const fallbackModel = page.getByRole("combobox", { name: "Pi Model" });
		await expect(fallbackModel).toHaveText("Codex Max Model");
		await expect(
			page.getByRole("switch", { name: "Fast mode" }),
		).toHaveCount(0);
		await fallbackModel.click();
		await expect(page.getByRole("option", { name: "Spark" })).toBeVisible();
		await expect(
			page.getByRole("option", { name: "Static hidden" }),
		).toBeVisible();
		await page.getByRole("option", { name: "Codex Max Model" }).click();
		await page.getByRole("combobox", { name: "Reasoning effort" }).click();
		await expect(
			page.getByRole("option", { name: "off", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("option", { name: "minimal", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("option", { name: "Ultra", exact: true }),
		).toHaveCount(0);
		await info.attach("no-metadata", {
			body: await page.screenshot({
				path: info.outputPath("no-metadata.png"),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		expect(errors).toEqual([]);
	});
}
