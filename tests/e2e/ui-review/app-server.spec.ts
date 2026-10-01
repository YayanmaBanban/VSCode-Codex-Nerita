// Phase 1 の操作可否と承認表示を、狭い幅の実コンポーネントで確認する。
import { expectSent, showState } from "../storyBridge";
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
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto(
		"/iframe.html?id=chat-app--app-server-streaming&viewMode=story",
	);
	const reasoning = page.getByRole("button", {
		name: "推論 実行中",
		exact: true,
	});
	await expect(reasoning).toHaveAttribute("aria-expanded", "false");
	await reasoning.click();
	await expect(reasoning).toHaveAttribute("aria-expanded", "true");
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
		page.getByRole("button", { name: "モデルと推論レベル" }),
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
		page.getByRole("combobox", { name: "Service tier" }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "モデルと推論レベル" }).click();
	const fast = page.getByRole("switch", { name: "ファストモード" });
	await expect(fast).toHaveCount(1);
	await expect(fast).not.toBeChecked();
	await fast.click();
	await expectSent(page, {
		type: "config/set",
		configId: "service_tier",
		value: "fast",
	});
	await showState(page, {
		configOptions: [
			{
				id: "service_tier",
				name: "Service tier",
				currentValue: "fast",
				options: [
					{ value: "default", name: "Standard" },
					{ value: "fast", name: "Fast" },
				],
			},
			{
				id: "model",
				name: "Model",
				currentValue: "test",
				options: [
					{ value: "test", name: "Test model" },
					{ value: "other", name: "Other model" },
				],
			},
		],
	});
	await expect(fast).toBeChecked();
	await fast.click();
	await expectSent(page, {
		type: "config/set",
		configId: "service_tier",
		value: "default",
	});
	await expect(
		page.getByRole("heading", { name: "新規チャット", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "コンテキストを追加" }),
	).toBeEnabled();
	await expect(
		page.getByRole("button", { name: "セッション一覧" }),
	).toBeEnabled();
	await expect(
		page.getByRole("combobox", { name: "Model", exact: true }),
	).toBeEnabled();
	await page.getByRole("combobox", { name: "Model", exact: true }).click();
	await page.getByRole("option", { name: "Other model" }).click();
	await expectSent(page, {
		type: "config/set",
		configId: "model",
		value: "other",
	});
	await page.keyboard.press("Escape");
	await page.screenshot({
		path: info.outputPath("app-server-ready.png"),
		fullPage: true,
	});
	await page.getByRole("textbox").fill("設定を確認してください");
	await page.getByRole("button", { name: "送信", exact: true }).click();
	await expectSent(page, {
		type: "prompt/send",
		text: "設定を確認してください",
	});
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
		await expect(approval).toContainText("workspace with spaces");
		await approval.scrollIntoViewIfNeeded();
		await page.screenshot({
			path: info.outputPath("app-server-approval.png"),
			fullPage: true,
		});
		await approval
			.getByRole("button", { name: decision, exact: true })
			.click();
		await expectSent(page, {
			type: "permission/respond",
			optionId: {
				今回のみ許可: "accept",
				拒否: "decline",
				ターンを中止: "cancel",
			}[decision]!,
			permissionId: "permission",
		});
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		expect(errors).toEqual([]);
	});
}
