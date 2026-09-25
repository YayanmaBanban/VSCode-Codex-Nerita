// Agent 専用カードの状態、幅、読み取りビューと親への復帰を実画面で確認する。
import { test, expect } from "@playwright/test";

for (const colorScheme of ["dark", "light"] as const) {
	test(`Agentの全アイコンを表示する: ${colorScheme}`, async ({
		page,
	}, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 720, height: 720 });
		await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
		await page.goto("/iframe.html?id=chat-agents--icons&viewMode=story");
		const icons = page.locator(".agent-card span[aria-hidden] > svg");
		await expect(icons).toHaveCount(14);
		for (const icon of await icons.all()) {
			await expect(icon).toBeVisible();
			const bounds = await icon.boundingBox();
			expect(bounds!.width).toBeGreaterThan(0);
			expect(bounds!.width).toBe(bounds!.height);
		}
		await info.attach(`icons-${colorScheme}`, {
			body: await page.screenshot({
				path: info.outputPath(`icons-${colorScheme}.png`),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		expect(errors).toEqual([]);
	});
	test(`Agentの全状態を狭い幅で表示する: ${colorScheme}`, async ({
		page,
	}, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 1000 });
		await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
		await page.goto("/iframe.html?id=chat-agents--states&viewMode=story");
		await expect(page.locator(".agent-card")).toHaveCount(9);
		await expect(page.locator(".agent-card .tool-progress")).toHaveCount(1);
		await expect(page.locator(".tool-progress")).toHaveCSS(
			"animation-name",
			"none",
		);
		await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 320);
		await page.screenshot({
			path: info.outputPath(`states-${colorScheme}.png`),
			fullPage: true,
		});
		expect(errors).toEqual([]);
	});
}

test("子と孫の閲覧から戻っても親の下書きが残る", async ({ page }, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	await page.setViewportSize({ width: 420, height: 820 });
	await page.goto("/iframe.html?id=chat-agents--viewer&viewMode=story");
	await page
		.getByRole("textbox", { name: "Codexへのメッセージ" })
		.fill("親への続きの指示");
	const entries = page.locator(".message, .agent-card");
	await expect(entries.nth(1)).toHaveClass(/agent-card/);
	await page
		.getByRole("button", { name: "swift-cheetahの会話を表示 · 実行中" })
		.focus();
	await page.keyboard.press("Enter");
	await expect(
		page.getByText("通知の処理を確認しました。", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("textbox", { name: "Codexへのメッセージ" }),
	).toBeHidden();
	await page.screenshot({
		path: info.outputPath("child.png"),
		fullPage: true,
	});
	await page
		.getByRole("button", { name: "helperの会話を表示 · 実行中" })
		.click();
	await expect(
		page.getByText("孫エージェントの調査結果です。", { exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "親へ戻る" }).click();
	await expect(
		page.getByText("通知の処理を確認しました。", { exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "親へ戻る" }).click();
	await expect(
		page.getByRole("textbox", { name: "Codexへのメッセージ" }),
	).toHaveText("親への続きの指示");
	await page.screenshot({
		path: info.outputPath("parent-restored.png"),
		fullPage: true,
	});
	expect(errors).toEqual([]);
});
