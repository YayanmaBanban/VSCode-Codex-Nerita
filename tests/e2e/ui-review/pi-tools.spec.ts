// Pi の読み取りカードを明暗・狭幅で操作し、停止後の継続と失敗表示を確認する。
import { expectSent, showState, acceptPrompt } from "../storyBridge";
import {
	piState,
	piNestedState,
} from "../../../apps/nerita-ui/stories/chat/fixtures/pi";
import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"] as const) {
	test(`Piの入れ子ツールと保存要約: ${theme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.emulateMedia({
			colorScheme: theme,
			reducedMotion: "reduce",
		});
		await page.setViewportSize({ width: 320, height: 900 });
		await page.goto(
			`/iframe.html?id=chat-app--pi-nested-tools&viewMode=story&globals=theme:${theme === "light" ? "light" : "dark2026"}`,
		);
		const children = page.locator(".nested-tool");
		await expect(children).toHaveCount(3);
		await expect(children.first()).toContainText(
			"親ツール: 複数のファイルを確認",
		);
		await expect(children.nth(1)).toContainText(
			"親ツール: ファイルを読む: src/長い名前のフォルダー/child.txt",
		);
		await expect(children.first()).toContainText("LIVE_ONLY_RESULT");
		await children.first().scrollIntoViewIfNeeded();
		await info.attach("nested-live", {
			body: await page.screenshot({
				path: info.outputPath("pi-nested-live.png"),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		await showState(page, piNestedState(true));
		await expect(children).toHaveCount(3);
		await expect(
			page.getByText("入れ子のツール履歴は一部省略されています。"),
		).toBeVisible();
		await expect(
			page.getByText(
				"保存された要約です。結果本文は保存されていません。",
				{ exact: true },
			),
		).toHaveCount(3);
		await expect(page.getByText("LIVE_ONLY_RESULT")).toHaveCount(0);
		await page
			.locator('.tool-card[data-kind="list"]')
			.scrollIntoViewIfNeeded();
		await info.attach("nested-parent", {
			body: await page.screenshot({
				path: info.outputPath("pi-nested-parent.png"),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		const read = children.first().getByRole("button");
		await read.focus();
		await page.keyboard.press("Enter");
		await expect(read).toHaveAttribute("aria-expanded", "true");
		await expect(children.first()).toContainText(
			'"path": "src/長い名前のフォルダー/child.txt"',
		);
		await children.first().scrollIntoViewIfNeeded();
		await info.attach("nested-history", {
			body: await page.screenshot({
				path: info.outputPath("pi-nested-history.png"),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		await children.last().scrollIntoViewIfNeeded();
		await expect(children.nth(1)).toContainText(
			"入力はサイズ制限により省略されています（8193 バイト）。",
		);
		await expect(children.nth(1)).toContainText("操作が拒否されました。");
		await expect(children.last()).toContainText("未完了");
		await expect(
			children.last().getByText("結果を待っています。", { exact: true }),
		).toHaveCount(0);
		await expect(children.last().getByRole("button")).toHaveAttribute(
			"aria-expanded",
			"true",
		);
		await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 320);
		await info.attach("nested-incomplete", {
			body: await page.screenshot({
				path: info.outputPath("pi-nested-incomplete.png"),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		expect(errors).toEqual([]);
	});

	test(`Piのread・ls・停止・継続会話: ${theme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.emulateMedia({
			colorScheme: theme,
			reducedMotion: "reduce",
		});
		await page.setViewportSize({ width: 320, height: 900 });
		await page.goto(
			`/iframe.html?id=chat-app--pi-tools&viewMode=story&globals=theme:${theme === "light" ? "light" : "dark2026"}`,
		);
		const completed = piState("completed", true);
		const running = {
			...completed,
			run: "running" as const,
			tools: [
				completed.tools[0]!,
				{
					...completed.tools[1]!,
					status: "in_progress" as const,
					content: [],
					rawInput: { offset: 1, limit: 20 },
				},
			],
		};
		await showState(page, running);
		const read = page.locator('.tool-card[data-kind="read"]');
		const list = page.locator('.tool-card[data-kind="list"]');
		await expect(read).toHaveAttribute("data-status", "in_progress");
		await read.getByRole("button").click();
		await expect(
			read.getByText("結果を待っています。", { exact: true }),
		).toBeVisible();
		await expect(read).toContainText("開始行: 1");
		await list.getByRole("button").click();
		await expect(list.locator("pre")).toHaveText(
			"extension/\nshared/\nwebview/",
		);
		await info.attach("running", {
			body: await page.screenshot({
				path: info.outputPath("pi-tools-running.png"),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		await page.getByRole("button", { name: "停止", exact: true }).click();
		await expectSent(page, { type: "prompt/cancel" });
		const stopped = {
			...running,
			run: "cancelled" as const,
			tools: [
				running.tools[0]!,
				{ ...running.tools[1]!, status: "cancelled" as const },
			],
		};
		await showState(page, stopped);
		await expect(read).toHaveAttribute("data-status", "cancelled");
		await expect(read.getByText("停止", { exact: true })).toBeVisible();
		await expect(read.getByRole("img", { name: "失敗" })).toHaveCount(0);
		await expect(list).toHaveAttribute("data-status", "completed");
		await info.attach("stopped", {
			body: await page.screenshot({
				path: info.outputPath("pi-tools-stopped.png"),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		await page.getByRole("textbox").fill("続けてください");
		await page.getByRole("button", { name: "送信", exact: true }).click();
		await expectSent(page, { type: "prompt/send", text: "続けてください" });
		await acceptPrompt(page);
		const history = [
			...stopped.tools,
			{ ...completed.tools[1]!, id: "pi-next-read", order: 6 },
		];
		await showState(page, {
			...completed,
			tools: history,
			messages: [
				...completed.messages,
				{
					id: "next-user",
					role: "user",
					text: "続けてください",
					order: 5,
				},
				{ ...completed.messages[1]!, id: "next-answer", order: 7 },
			],
		});
		await expect(read).toHaveCount(2);
		await expect(read.last()).toHaveAttribute("data-status", "completed");
		await expect(read.first()).toHaveAttribute("data-status", "cancelled");
		await expect(read.last().getByRole("button")).toHaveAttribute(
			"aria-expanded",
			"false",
		);
		await read.last().getByRole("button").focus();
		await page.keyboard.press("Enter");
		await expect(read.last().locator("pre")).toContainText(
			"<script>これはファイルの内容です</script>",
		);
		await expect(read.last().locator("script")).toHaveCount(0);
		await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 320);
		await info.attach("completed", {
			body: await page.screenshot({
				path: info.outputPath("pi-tools-completed.png"),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		await page.getByRole("textbox").fill("missingを確認");
		await page.getByRole("button", { name: "送信", exact: true }).click();
		await expectSent(page, { type: "prompt/send", text: "missingを確認" });
		await acceptPrompt(page);
		await showState(page, {
			tools: [
				...history,
				{
					...completed.tools[1]!,
					id: "missing",
					order: 6,
					status: "failed",
					content: [
						{
							type: "content",
							content: {
								type: "text",
								text: "ENOENT: missing.txt",
							},
						},
					],
				},
			],
		});
		await expect(read).toHaveCount(3);
		await expect(read.last()).toHaveAttribute("data-status", "failed");
		await expect(
			read.last().getByRole("img", { name: "失敗" }),
		).toBeVisible();
		await expect(read.last().locator("pre")).toContainText("ENOENT");
		await info.attach("failed", {
			body: await page.screenshot({
				path: info.outputPath("pi-tools-failed.png"),
				fullPage: true,
			}),
			contentType: "image/png",
		});
		await page.getByRole("button", { name: "新しいチャット" }).click();
		await expectSent(page, { type: "session/new" });
		await showState(page, piState());
		await expect(page.locator(".tool-card")).toHaveCount(0);
		await expect(page.getByRole("log")).toBeEmpty();
		await info.attach("browser-errors", {
			body: JSON.stringify(errors),
			contentType: "application/json",
		});
		expect(errors).toEqual([]);
	});
}
