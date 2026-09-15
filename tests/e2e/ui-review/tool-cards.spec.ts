// 専用・汎用カードの内容、完了時の自動折り畳みと再展開を検証する。
import { test, expect } from "@playwright/test";

test("ターン完了後のAIRタスクを既存カードから停止する", async ({
	page,
}, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(
		"/iframe.html?id=chat-tool-cards--background&viewMode=story",
	);
	const card = page.locator(".tool-card");
	await expect(card).toHaveCount(1);
	await expect(card.locator(".tool-progress")).toBeVisible();
	await expect(
		card.getByRole("button", { name: "pnpm.cmd test を停止" }),
	).toBeEnabled();
	await card.getByRole("button", { name: "pnpm.cmd test を停止" }).click();
	await expect(card.locator(".tool-progress, .tool-stop")).toHaveCount(0);
	await card
		.getByRole("button", { name: "pnpm.cmd test", exact: true })
		.click();
	await expect(card.locator(".tool-body")).toContainText("configuration");
	await expect(page.getByLabel("送信した要求")).toContainText(
		'"type":"execution/stop"',
	);
	await page.screenshot({
		path: info.outputPath("background-stopped.png"),
		fullPage: true,
	});
	expect(errors).toEqual([]);
});

for (const theme of ["dark", "light"] as const) {
	test(`ツールカードの開閉と表示: ${theme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.emulateMedia({ colorScheme: theme });
		await page.setViewportSize({ width: 320, height: 900 });
		await page.goto(
			"/iframe.html?id=chat-tool-cards--running&viewMode=story",
		);
		const guardian = page.getByRole("button", {
			name: "コマンドの安全性を確認 実行中",
		});
		const edit = page.getByRole("button", { name: "Editing files 実行中" });
		await expect(guardian).toHaveAttribute("aria-expanded", "true");
		await expect(page.locator(".file-diff-removed")).toHaveText(
			"-echo hello\n",
		);
		await expect(page.locator(".file-diff-added")).toHaveText([
			"+echo hello world\n",
			"+pause\n",
		]);
		await expect(page.locator(".file-diff-lines")).toContainText(
			" @echo off",
		);
		await expect(
			page.getByText("実行結果を待っています。", { exact: true }),
		).toBeVisible();
		await edit.click();
		await expect(edit).toHaveAttribute("aria-expanded", "false");
		await expect(guardian).toHaveAttribute("aria-expanded", "true");
		await edit.focus();
		await page.keyboard.press("Enter");
		await expect(edit).toHaveAttribute("aria-expanded", "true");
		await info.attach("running", {
			body: await page.screenshot({
				fullPage: true,
				path: info.outputPath("running.png"),
			}),
			contentType: "image/png",
		});
		await page.getByRole("button", { name: "完了通知を受信" }).click();
		const completed = page.getByRole("button", {
			name: "コマンドの安全性を確認",
			exact: true,
		});
		await expect(completed).toHaveAttribute("aria-expanded", "false");
		await expect(
			page.getByRole("button", { name: "Editing files", exact: true }),
		).toHaveAttribute("aria-expanded", "false");
		await expect(
			page.getByRole("button", { name: "Guardian Review", exact: true }),
		).toHaveAttribute("aria-expanded", "true");
		await expect(page.locator(".tool-progress")).toHaveCount(0);
		await expect(page.locator(".tool-stop")).toHaveCount(0);
		await expect(page.getByRole("img", { name: "失敗" })).toHaveCount(1);
		await expect(
			page.locator(".tool-header").getByText(/完了|失敗/),
		).toHaveCount(0);
		await completed.click();
		await expect(
			page.getByText("バージョン確認のため承認しました。", {
				exact: true,
			}),
		).toBeVisible();
		await page.getByRole("button", { name: "完了通知を受信" }).click();
		await expect(completed).toHaveAttribute("aria-expanded", "true");
		await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 320);
		await info.attach("completed-reopened", {
			body: await page.screenshot({ fullPage: true }),
			contentType: "image/png",
		});
		expect(errors).toEqual([]);
	});
}

test("execute の停止要求と失敗アイコン、think の種別判定", async ({
	page,
}, info) => {
	await page.goto("/iframe.html?id=chat-tool-cards--running&viewMode=story");
	const execute = page.locator('.tool-card[data-kind="execute"]').first();
	await expect(execute.locator(".tool-progress")).toBeVisible();
	const spinner = execute.locator(".tool-progress");
	for (const time of [0, 300, 600]) {
		await spinner.evaluate((element, time) => {
			const animation = element.getAnimations()[0]!;
			animation.pause();
			animation.currentTime = time;
		}, time);
		await execute.screenshot({
			path: info.outputPath(`spinner-${time}.png`),
		});
	}
	await page.emulateMedia({ reducedMotion: "reduce" });
	await expect(spinner).toHaveCSS("animation-name", "none");
	await expect(
		page.locator('.tool-card[data-kind="think"] .lucide-sprout'),
	).toHaveCount(1);
	await expect(
		page
			.getByRole("button", { name: "Guardian Review", exact: true })
			.locator(".lucide-shield-check"),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "端末を準備 を停止" }),
	).toBeDisabled();
	await execute.getByRole("button", { name: "pnpm.cmd test を停止" }).click();
	await expect(page.getByLabel("送信した要求")).toContainText(
		'"type":"execution/stop"',
	);
	await expect(page.getByLabel("送信した要求")).toContainText(
		'"runId":"run-test"',
	);
	await expect(execute.locator(".tool-progress, .tool-stop")).toHaveCount(0);
	await expect(execute.getByRole("img", { name: "失敗" })).toBeVisible();
	await expect(execute.getByRole("button")).toHaveAttribute(
		"aria-expanded",
		"true",
	);
	await info.attach("execute-stopped", {
		body: await page.screenshot({ fullPage: true }),
		contentType: "image/png",
	});
});
