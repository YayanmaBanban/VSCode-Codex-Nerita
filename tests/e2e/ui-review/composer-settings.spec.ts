// 設定順・選択値・添付・使用量アニメーションを明暗テーマで確認する。
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	test(`計画本文を返信欄へ表示: ${theme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 900 });
		await page.emulateMedia({ colorScheme: theme });
		await page.goto(
			"/iframe.html?id=chat-composer-settings--proposed-plan&viewMode=story",
		);
		await expect(
			page.getByRole("heading", { name: "認証機能の実装計画" }),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.locator(".message.assistant")).toContainText(
			"回帰テストを追加して検証する。",
		);
		await info.attach("proposed-plan", {
			body: await page.screenshot({
				path: info.outputPath("proposed-plan.png"),
			}),
			contentType: "image/png",
		});
		expect(errors).toEqual([]);
	});
	test(`入力欄の設定と使用量: ${theme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 900 });
		await page.emulateMedia({
			colorScheme: theme,
			reducedMotion: "no-preference",
		});
		await page.goto(
			"/iframe.html?id=chat-composer-settings--connected&viewMode=story",
		);
		await expect(
			page.getByRole("combobox", { name: "Collaboration mode" }),
		).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByRole("combobox", { name: "Mode", exact: true }),
		).toHaveText("Approve for me");
		await expect(
			page.getByRole("combobox", { name: "Model", exact: true }),
		).toHaveText("6 Astra");
		expect(
			await page
				.locator(".settings-toolbar > *")
				.evaluateAll((elements: Element[]) =>
					elements.map((el) => el.classList.item(0)),
				),
		).toEqual(["attach-button", "context-usage", "contents"]);
		await expect(
			page.locator(".config-control .lucide-chevron-down"),
		).toHaveCount(4);
		await page
			.getByRole("combobox", { name: "Collaboration mode" })
			.click();
		await expect(
			page.getByRole("option", { name: "Goal", exact: true }),
		).toBeVisible();
		await info.attach("collaboration-options", {
			body: await page.screenshot({
				path: info.outputPath("collaboration-options.png"),
			}),
			contentType: "image/png",
		});
		await page.getByRole("option", { name: "Plan", exact: true }).click();
		await expect(page.getByLabel("最後の要求")).toContainText(
			'"value":"plan"',
		);
		await page
			.getByRole("combobox", { name: "Collaboration mode" })
			.click();
		await page.getByRole("option", { name: "Goal", exact: true }).click();
		await expect(page.getByLabel("最後の要求")).toContainText(
			'"value":"goal"',
		);
		await page
			.getByRole("combobox", { name: "Collaboration mode" })
			.click();
		await page
			.getByRole("option", { name: "Default", exact: true })
			.click();
		await expect(page.getByLabel("最後の要求")).toContainText(
			'"value":"default"',
		);
		await page
			.getByRole("combobox", { name: "Model", exact: true })
			.click();
		await page
			.getByRole("option", { name: "5.6 Luna", exact: true })
			.click();
		await page.getByRole("combobox", { name: "Reasoning effort" }).click();
		await expect(
			page.getByRole("option", { name: "Ultra", exact: true }),
		).toHaveCount(0);
		await page.getByRole("option", { name: "High", exact: true }).click();
		await page.getByRole("switch", { name: "Fast mode" }).click();
		await expect(page.getByRole("switch")).toBeChecked();
		await expect(page.getByLabel("最後の要求")).toContainText(
			'"value":"on"',
		);
		await page.getByRole("button", { name: "ファイルを添付" }).click();
		await expect(
			page.locator(".attachment .lucide-file-code"),
		).toBeVisible();
		await expect(
			page.locator(".attachment .lucide-file-image"),
		).toBeVisible();
		await page.getByRole("button", { name: "design.png を開く" }).click();
		await expect(page.getByLabel("最後の要求")).toContainText(
			'"type":"attachment/open"',
		);
		await page.getByRole("button", { name: "使用量40%" }).click();
		const ring = page.locator(".context-fill");
		const offset = () =>
			ring.evaluate((el) =>
				Number(getComputedStyle(el).strokeDashoffset.replace("px", "")),
			);
		await expect.poll(offset).toBeCloseTo(60, 0);
		await expect(page.getByRole("progressbar")).toHaveAttribute(
			"data-warning",
			"false",
		);
		await page.getByRole("button", { name: "使用量60%" }).click();
		await expect(page.getByRole("progressbar")).toHaveAttribute(
			"aria-valuenow",
			"600",
		);
		expect(await offset()).toBeGreaterThan(40);
		expect(await offset()).toBeLessThanOrEqual(60);
		await info.attach("usage-increment", {
			body: await page
				.locator(".composer")
				.screenshot({ path: info.outputPath("increment.png") }),
			contentType: "image/png",
		});
		await expect.poll(offset).toBeCloseTo(40, 0);
		await expect(page.getByRole("progressbar")).toHaveAttribute(
			"data-warning",
			"true",
		);
		await info.attach("settings", {
			body: await page.screenshot({
				fullPage: true,
				path: info.outputPath("settings.png"),
			}),
			contentType: "image/png",
		});
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.getByRole("button", { name: "使用量20%" }).click();
		await expect.poll(offset).toBe(80);
		await page
			.getByRole("button", { name: "settings.ts を取り外す" })
			.click();
		await expect(
			page.getByRole("button", { name: "settings.ts を開く" }),
		).toHaveCount(0);
		await page.getByRole("button", { name: "切断通知" }).click();
		for (const control of await page.getByRole("combobox").all()) {
			await expect(control).toBeDisabled();
		}
		await expect(page.getByRole("switch")).toBeDisabled();
		await expect(
			page.getByRole("button", { name: "ファイルを添付" }),
		).toBeDisabled();
		await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 320);
		expect(errors).toEqual([]);
	});
}
