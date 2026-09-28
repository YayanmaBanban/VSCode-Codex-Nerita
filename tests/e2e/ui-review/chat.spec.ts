// 実際のチャットストーリーを操作し、画像・動画・トレースとブラウザエラーを保存する。
import { expectSent, showState, acceptPrompt } from "../storyBridge";
import { test, expect, type Page } from "@playwright/test";
const pageErrors = new Map<Page, string[]>();
test.beforeEach(({ page }) => {
	const errors: string[] = [];
	pageErrors.set(page, errors);
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
});
test.afterEach(async ({ page }, info) => {
	const errors = pageErrors.get(page) ?? [];
	await info.attach("browser-errors", {
		body: JSON.stringify(errors),
		contentType: "application/json",
	});
	pageErrors.delete(page);
	expect(errors).toEqual([]);
});
test("送信と新規会話の要求", async ({ page }, info) => {
	await page.goto("/iframe.html?id=chat-app--empty&viewMode=story");
	await page.getByRole("textbox").fill("設定を確認してください");
	await page.getByRole("button", { name: "送信", exact: true }).click();
	await expectSent(page, {
		type: "prompt/send",
		text: "設定を確認してください",
		sessionId: "story-session",
	});
	await acceptPrompt(page);
	await expect(page.getByRole("textbox")).toBeEmpty();
	await page.getByRole("button", { name: "新しいチャット" }).click();
	await expectSent(page, { type: "session/new" });
	await info.attach("empty", {
		body: await page.screenshot(),
		contentType: "image/png",
	});
});
for (const [label, optionId] of [
	["今回のみ許可", "allow"],
	["拒否", "reject"],
]) {
	test(`承認要求の送信: ${label}`, async ({ page }, info) => {
		await page.goto("/iframe.html?id=chat-app--permission&viewMode=story");
		await info.attach("permission", {
			body: await page.screenshot(),
			contentType: "image/png",
		});
		await page.getByRole("button", { name: label, exact: true }).click();
		await expectSent(page, {
			type: "permission/respond",
			permissionId: "permission",
			optionId,
			sessionId: "story-session",
			runId: "story-run",
		});
	});
}
test("停止要求と停止済み状態の表示", async ({ page }, info) => {
	await page.goto("/iframe.html?id=chat-app--streaming&viewMode=story");
	await page.getByRole("button", { name: "停止", exact: true }).click();
	await expectSent(page, {
		type: "prompt/cancel",
		sessionId: "story-session",
		runId: "story-run",
	});
	await showState(page, { run: "cancelled" });
	await expect(page.getByText("停止しました", { exact: true })).toBeVisible();
	await info.attach("cancelled", {
		body: await page.screenshot(),
		contentType: "image/png",
	});
});
test("IME確定・改行・キーボード送信", async ({ page }) => {
	await page.goto("/iframe.html?id=chat-app--empty&viewMode=story");
	const input = page.getByRole("textbox");
	await input.fill("日本語の入力");
	await input.dispatchEvent("compositionstart");
	await input.dispatchEvent("keydown", {
		key: "Enter",
		code: "Enter",
		isComposing: true,
	});
	await expect(page.getByRole("log")).toBeEmpty();
	await input.dispatchEvent("compositionend");
	await input.press("Enter");
	await page.keyboard.insertText("2行目");
	await expect(page.getByRole("log")).toBeEmpty();
	await input.press("Shift+Enter");
	await page.keyboard.insertText("3行目");
	await expect(input).toHaveText("日本語の入力\n2行目\n3行目", {
		useInnerText: true,
	});
	await input.press("Control+Enter");
	await expectSent(page, {
		type: "prompt/send",
		text: "日本語の入力\n2行目\n3行目",
	});
});
test("回答コピー・対応する送信文と返信末尾へ移動", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/iframe.html?id=chat-app--completed&viewMode=story");
	await page.getByRole("button", { name: "回答をコピー" }).click();
	await expect(page.locator(".message").getByRole("status")).toHaveText(
		"コピーしました",
	);
	const copied = await page.evaluate(() => navigator.clipboard.readText());
	expect(copied).toContain("設定ファイルの変更点を整理しました。");
	expect(copied).toContain("```ts");
	expect(copied).toContain(
		"長いパスやコードも画面の幅に合わせて折り返します。".repeat(12),
	);
	await page.getByRole("button", { name: "送信メッセージへ移動" }).click();
	await expect(page.locator(".message.user")).toBeFocused();
	await expect(page.locator(".message.user")).toBeInViewport();
	await page.getByRole("button", { name: "回答の末尾へ移動" }).click();
	await expect(
		page.locator(".message.assistant .message-actions"),
	).toBeFocused();
	await expect(
		page.locator(".message.assistant .message-actions"),
	).toBeInViewport();
	await page.locator(".message.assistant .message-text").click();
});
for (const colorScheme of ["dark", "light"] as const) {
	test(`空の会話・520px・補助文字: ${colorScheme}`, async ({
		page,
	}, info) => {
		await page.setViewportSize({ width: 520, height: 820 });
		await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
		await page.goto("/iframe.html?id=chat-app--empty&viewMode=story");
		const empty = page.locator(".empty-state");
		await expect(empty).toHaveText(
			"このワークスペースで作業しますworkspace/project",
		);
		await page.evaluate(() => {
			document.documentElement.style.setProperty(
				"--vscode-font-size",
				"10px",
			);
			document.documentElement.style.setProperty(
				"--vscode-descriptionForeground",
				"rgb(120, 130, 140)",
			);
		});
		expect(
			await page
				.locator("main *")
				.evaluateAll((nodes) =>
					nodes
						.filter(
							(node) =>
								Array.from(node.childNodes).some(
									(child) =>
										child.nodeType === Node.TEXT_NODE &&
										child.textContent?.trim(),
								) &&
								parseFloat(getComputedStyle(node).fontSize) <
									12,
						)
						.map((node) => node.tagName),
				),
		).toEqual([]);
		await info.attach(`empty-${colorScheme}`, {
			body: await page.screenshot(),
			contentType: "image/png",
		});
	});
	test(`狭い幅・長文・コード: ${colorScheme}`, async ({ page }, info) => {
		await page.setViewportSize({ width: 320, height: 760 });
		await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
		await page.goto("/iframe.html?id=chat-app--completed&viewMode=story");
		await expect(page.getByText(/const config/)).toBeVisible();
		await page.evaluate(() => document.fonts.ready);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		await info.attach(`narrow-${colorScheme}`, {
			body: await page.screenshot(),
			contentType: "image/png",
		});
	});
}
