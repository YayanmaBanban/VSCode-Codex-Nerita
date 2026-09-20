// フルパス貼り付けのチップ化と、通常テキストへのフォールバックを確認する。
import { test, expect } from "@playwright/test";
import { paste } from "./composerHelpers";

test("パス確認の応答より先に本文を編集した場合は変換しない", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/iframe.html?id=chat-composer-menu--ready&viewMode=story");
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await expect(input).toBeVisible();
	await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
	await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
	await input.fill("#");
	await paste(input, "D:\\workspace\\project\\empty");
	await input.fill("書き直した本文");
	await page.clock.runFor(100);
	await expect(input).toHaveText("書き直した本文");
	await expect(input.locator(".inline-path-reference")).toHaveCount(0);
	expect(errors).toEqual([]);
});

for (const colorScheme of ["dark", "light"] as const) {
	test(`フルパスのファイル・フォルダを自動チップ化: ${colorScheme}`, async ({
		page,
	}, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.emulateMedia({ colorScheme });
		await page.goto(
			"/iframe.html?id=chat-composer-menu--ready&viewMode=story",
		);
		const input = page.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		await input.fill("前文#後文");
		await input.press("Home");
		for (let i = 0; i < 3; i++) {
			await input.press("ArrowRight");
		}
		await paste(input, '"D:\\workspace\\project\\日本語 sample.md"');
		await expect(input.locator(".inline-path-reference")).toHaveCount(1);
		await expect(input).toHaveText("前文日本語 sample.md 後文");
		await input.press("Control+z");
		await expect(input.locator(".inline-path-reference")).toHaveCount(0);
		await expect(input).toContainText(
			'#"D:\\workspace\\project\\日本語 sample.md"',
		);
		await input.press("Control+y");
		await expect(input.locator(".inline-path-reference")).toHaveCount(1);
		await input.press("End");
		await input.press("#");
		await paste(input, "D:/workspace/project/empty/");
		await expect(input.locator(".inline-path-reference")).toHaveCount(2);
		await page.screenshot({ path: info.outputPath("pasted-paths.png") });
		await input.press("Enter");
		await expect(page.locator(".message.user")).toContainText(
			"D:\\workspace\\project\\empty",
		);
		await expect(page.locator(".message.user")).toContainText(
			"D:\\workspace\\project\\日本語 sample.md",
		);
		expect(errors).toEqual([]);
	});
}

test("存在しないパスと#のない貼り付けは本文を維持する", async ({
	page,
}, info) => {
	await page.goto("/iframe.html?id=chat-composer-menu--ready&viewMode=story");
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await input.fill("#");
	await paste(input, "D:\\missing.txt");
	await expect(input).toHaveText("#D:\\missing.txt");
	await input.fill("");
	await paste(input, "D:\\workspace\\project\\日本語 sample.md");
	await expect(input).toHaveText("D:\\workspace\\project\\日本語 sample.md");
	await expect(input.locator(".inline-path-reference")).toHaveCount(0);
	await page.screenshot({ path: info.outputPath("plain-path.png") });
});
