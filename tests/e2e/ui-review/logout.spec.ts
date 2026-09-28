// 両方のログアウト入口と再ログイン、入力の改行・送信を実 UI で検証する。
import { expectSent, showState, acceptPrompt } from "../storyBridge";
import { test, expect } from "@playwright/test";
import {
	codexConnectionText,
	codexAuthMethods,
} from "../../../src/shared/codexConnection";

for (const colorScheme of ["dark", "light"] as const) {
	test(`ログアウト・改行・Ctrl+Enter: ${colorScheme}`, async ({
		page,
	}, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 760 });
		await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
		await page.goto("/iframe.html?id=chat-app--empty&viewMode=story");
		const input = page.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		await input.fill("1行目");
		await input.press("Enter");
		await page.keyboard.insertText("2行目");
		await input.press("Shift+Enter");
		await page.keyboard.insertText("3行目");
		await expect(input).toHaveText("1行目\n2行目\n3行目", {
			useInnerText: true,
		});
		await expect(page.getByRole("log")).toBeEmpty();
		await input.dispatchEvent("keydown", {
			key: "Enter",
			ctrlKey: true,
			isComposing: true,
		});
		await expect(page.getByRole("log")).toBeEmpty();
		await page.screenshot({ path: info.outputPath("multiline.png") });
		await input.press("Control+Enter");
		await expectSent(page, {
			type: "prompt/send",
			text: "1行目\n2行目\n3行目",
		});
		await acceptPrompt(page);
		await showState(page, { run: "running", runId: "run" });
		await page.getByRole("button", { name: "オプション" }).click();
		await expect(
			page.getByRole("menuitem", { name: "ログアウト" }),
		).toBeDisabled();
		await page.keyboard.press("Escape");
		await showState(page, { run: "completed" });
		await page.getByRole("button", { name: "オプション" }).click();
		await page.screenshot({ path: info.outputPath("logout-menu.png") });
		await page.getByRole("menuitem", { name: "ログアウト" }).click();
		await expectSent(page, { type: "auth/logout" });
		await showState(page, {
			connection: "auth-required",
			messages: [],
			authMethods: codexAuthMethods(),
		});
		await expect(page.getByRole("region", { name: "認証" })).toBeVisible();
		await expect(page.locator(".message")).toHaveCount(0);
		await page.screenshot({ path: info.outputPath("logged-out.png") });
		await page
			.getByRole("button", {
				name: codexConnectionText.chatgpt,
				exact: true,
			})
			.click();
		await expectSent(page, { type: "auth/start", methodId: "chatgpt" });
		await showState(page, { connection: "ready" });
		await input.fill("/log");
		await expect(
			page.getByRole("option", { name: /logout/ }),
		).toBeVisible();
		await page.screenshot({ path: info.outputPath("logout-command.png") });
		await input.press("Tab");
		await expect(input).toHaveText("/logout");
		await input.press("Control+Enter");
		await expectSent(page, { type: "prompt/send", text: "/logout" });
		await expect(page.locator(".message")).toHaveCount(0);
		expect(errors).toEqual([]);
	});
}
