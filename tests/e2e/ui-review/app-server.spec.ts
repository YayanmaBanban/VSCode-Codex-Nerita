// Phase 1 の操作可否と承認表示を、狭い幅の実コンポーネントで確認する。
import { test, expect } from "@playwright/test";

test("App Serverの推論・端末出力・差分と実行中の設定", async ({
	page,
}, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	await page.setViewportSize({ width: 320, height: 900 });
	await page.goto(
		"/iframe.html?id=chat-app--app-server-streaming&viewMode=story",
	);
	await expect(
		page.getByText("設定の依存関係を確認しています。", { exact: false }),
	).toBeVisible();
	await expect(
		page.getByText("型検査を実行中...", { exact: false }),
	).toBeVisible();
	await page
		.getByText("設定の依存関係を確認しています。", { exact: false })
		.scrollIntoViewIfNeeded();
	await page.screenshot({
		path: info.outputPath("app-server-reasoning.png"),
		fullPage: true,
	});
	const diff = page.getByRole("region", { name: "src/config.ts の差分" });
	await expect(diff.locator(".file-diff-added")).toContainText(
		"+export const enabled = true;",
	);
	await expect(diff.locator(".file-diff-removed")).toContainText(
		"-export const enabled = false;",
	);
	await expect(
		page.getByRole("combobox", { name: "Model", exact: true }),
	).toBeDisabled();
	await diff.scrollIntoViewIfNeeded();
	await page.screenshot({
		path: info.outputPath("app-server-streaming-diff.png"),
		fullPage: true,
	});
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	expect(errors).toEqual([]);
});

test("App Server の利用可能な操作と送信", async ({ page }, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	await page.goto("/iframe.html?id=chat-app--app-server&viewMode=story");
	await expect(
		page.getByRole("heading", { name: "Codex", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "ファイルを添付" }),
	).toBeEnabled();
	await expect(
		page.getByRole("button", { name: "セッション一覧" }),
	).toBeEnabled();
	await expect(
		page.getByRole("combobox", { name: "Model", exact: true }),
	).toBeEnabled();
	await page.getByRole("combobox", { name: "Model", exact: true }).click();
	await page.getByRole("option", { name: "Other model" }).click();
	await expect(
		page.getByRole("combobox", { name: "Model", exact: true }),
	).toContainText("Other model");
	await page.screenshot({
		path: info.outputPath("app-server-ready.png"),
		fullPage: true,
	});
	await page.getByRole("textbox").fill("設定を確認してください");
	await page.getByRole("button", { name: "送信", exact: true }).click();
	await expect(page.getByText(/作業が完了しました/)).toBeVisible();
	expect(errors).toEqual([]);
});

for (const decision of ["今回のみ許可", "拒否", "ターンを中止"]) {
	test(`App Server の承認: ${decision}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 820 });
		await page.goto(
			"/iframe.html?id=chat-app--app-server-permission&viewMode=story",
		);
		const approval = page.getByRole("region", { name: "承認要求" });
		await expect(approval).toBeVisible();
		await expect(approval).toContainText("D:/workspace with spaces");
		await approval.scrollIntoViewIfNeeded();
		await page.screenshot({
			path: info.outputPath("app-server-approval.png"),
			fullPage: true,
		});
		await approval
			.getByRole("button", { name: decision, exact: true })
			.click();
		await expect(approval).toHaveCount(0);
		if (decision === "ターンを中止") {
			await expect(
				page.getByText("停止しました", { exact: true }),
			).toBeVisible();
		}
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		expect(errors).toEqual([]);
	});
}
