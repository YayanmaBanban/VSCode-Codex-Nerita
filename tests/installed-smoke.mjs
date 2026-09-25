// 隔離した VS Code にインストールした VSIX から実際の会話を検証する。
import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(
	process.env.CODEX_SMOKE_ROOT ?? "dist/installed-smoke",
);
const executablePath = process.env.VSCODE_EXECUTABLE;
if (!executablePath) {
	throw new Error("VSCODE_EXECUTABLE is required");
}
await mkdir(path.join(root, "workspace with spaces"), { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
	executablePath,
	env,
	timeout: 30000,
	args: [
		`--user-data-dir=${path.join(root, "profile")}`,
		`--extensions-dir=${path.join(root, "extensions")}`,
		"--skip-welcome",
		"--skip-release-notes",
		"--disable-workspace-trust",
		"--disable-updates",
		path.join(root, "workspace with spaces"),
	],
});
try {
	const page = await app.firstWindow();
	await page.waitForSelector(".monaco-workbench", { timeout: 30000 });
	await page.screenshot({ path: path.join(root, "startup.png") });
	await page.keyboard.press("F1");
	await page
		.locator(".quick-input-widget input")
		.fill(">Nerita for Codex: チャットを開く");
	await page.keyboard.press("Enter");
	let chat;
	// Webview の準備は新規 frame のロードで非同期に進む。
	for (let attempt = 0; attempt < 100; attempt++) {
		chat = page
			.frames()
			.find(
				(frame) =>
					frame.url().includes("index.html?id=") &&
					frame.url().includes("vscode-webview"),
			);
		chat = await findConnectFrame(page, chat);
		if (
			chat &&
			(await chat.getByRole("button", { name: "接続する" }).count())
		) {
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	if (
		!chat ||
		!(await chat.getByRole("button", { name: "接続する" }).count())
	) {
		await writeFile(
			path.join(root, "frames.json"),
			JSON.stringify(
				page
					.frames()
					.map((frame) => ({ name: frame.name(), url: frame.url() })),
			),
		);
		throw new Error("Chat webview not found");
	}
	await chat.getByRole("button", { name: "接続する" }).click();
	await chat
		.getByText("接続済み", { exact: true })
		.waitFor({ timeout: 60000 });
	await chat
		.getByRole("textbox")
		.fill(
			"Reply with exactly APP_SERVER_INSTALLED_OK. Do not use tools or modify files.",
		);
	await chat.getByRole("button", { name: "送信", exact: true }).click();
	await chat
		.locator(".message.assistant")
		.getByText("APP_SERVER_INSTALLED_OK", { exact: true })
		.waitFor({ timeout: 90000 });
	await expect(
		chat.getByRole("button", { name: "停止", exact: true }),
	).toHaveCount(0);
	await expect(
		chat.getByRole("button", { name: "ファイルを添付" }),
	).toBeEnabled();
	await expect(
		chat.getByRole("combobox", { name: "Model", exact: true }),
	).toBeEnabled();
	await expect(
		chat.getByRole("button", { name: "セッション一覧" }),
	).toBeEnabled();
	await page.screenshot({ path: path.join(root, "conversation.png") });
	await page.keyboard.press("F1");
	await page
		.locator(".quick-input-widget input")
		.fill(">View: Show Explorer");
	await page.keyboard.press("Enter");
	await page.keyboard.press("F1");
	await page
		.locator(".quick-input-widget input")
		.fill(">Nerita for Codex: チャットを開く");
	await page.keyboard.press("Enter");
	for (let attempt = 0; attempt < 100; attempt++) {
		chat = await findPromptFrame(page, chat);
		if (
			!chat.isDetached() &&
			(await chat.locator("textarea#prompt").count())
		) {
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	await chat
		.locator(".message.assistant")
		.getByText("APP_SERVER_INSTALLED_OK", { exact: true })
		.waitFor();
	await chat
		.getByRole("textbox")
		.fill("Count from 1 to 10000. Do not use tools or modify files.");
	await chat.getByRole("button", { name: "送信", exact: true }).click();
	await chat.getByRole("button", { name: "停止", exact: true }).click();
	await chat
		.getByText("停止しました", { exact: true })
		.waitFor({ timeout: 15000 });
	await page.screenshot({ path: path.join(root, "cancelled.png") });
	await expect(chat.getByText("接続済み", { exact: true })).toBeVisible();
	await chat
		.getByRole("textbox")
		.fill(
			"Reply with exactly APP_SERVER_CONTINUED_OK. Do not use tools or modify files.",
		);
	await chat.getByRole("button", { name: "送信", exact: true }).click();
	await expect(chat.locator(".message.assistant").last()).toContainText(
		"APP_SERVER_CONTINUED_OK",
		{ timeout: 90000 },
	);
	await expect(
		chat.getByRole("button", { name: "停止", exact: true }),
	).toHaveCount(0);
	await expect(chat.locator(".message.user")).toHaveCount(3);
	await page.screenshot({ path: path.join(root, "continued.png") });
	await chat.getByRole("button", { name: "新しいチャット" }).click();
	await chat
		.getByText("このワークスペースで作業します", { exact: true })
		.waitFor();
	await chat
		.getByRole("button", { name: "セッション一覧", exact: true })
		.click();
	const panel = chat.getByRole("complementary", { name: "セッション一覧" });
	await expect(panel.getByRole("listitem")).toHaveCount(1, {
		timeout: 15000,
	});
	await panel.getByRole("button", { name: /名前を変更/ }).click();
	await panel
		.getByRole("textbox", { name: "新しいセッション名" })
		.fill("インストール済み履歴テスト");
	await panel.getByRole("button", { name: "保存", exact: true }).click();
	await panel
		.getByRole("button", { name: "インストール済み履歴テストを開く" })
		.click();
	await expect(chat.locator(".message.assistant").last()).toContainText(
		"APP_SERVER_CONTINUED_OK",
	);
	await page.screenshot({ path: path.join(root, "history-resumed.png") });
	await panel
		.getByRole("button", {
			name: "インストール済み履歴テストをアーカイブ",
			exact: true,
		})
		.click();
	await expect(panel.getByRole("listitem")).toHaveCount(0);
	await panel
		.getByRole("button", { name: "アーカイブ済み", exact: true })
		.click();
	await expect(panel.getByRole("listitem")).toHaveCount(1);
	await page.screenshot({ path: path.join(root, "history-archived.png") });
	await panel
		.getByRole("button", {
			name: "インストール済み履歴テストをアーカイブから戻す",
		})
		.click();
	await expect(panel.getByRole("listitem")).toHaveCount(0);
	await panel
		.getByRole("button", { name: "通常の履歴", exact: true })
		.click();
	await panel
		.getByRole("button", { name: "インストール済み履歴テストを開く" })
		.click();
	await expect(chat.locator(".message.assistant").last()).toContainText(
		"APP_SERVER_CONTINUED_OK",
	);
	await page.screenshot({ path: path.join(root, "history-unarchived.png") });
	console.log(
		"Installed VSIX: reply, interrupt, continue, new thread, history resume, rename, archive and unarchive verified",
	);
} catch (error) {
	const page = await app.firstWindow();
	await page.screenshot({ path: path.join(root, "failure.png") });
	throw error;
} finally {
	await app.close();
}

/** 再表示後の入力欄を持つ Webview フレームを探す。 */
async function findPromptFrame(page, chat) {
	const candidates = page.frames();
	for (const frame of candidates) {
		if (await frame.locator("textarea#prompt").count()) {
			chat = frame;
			break;
		}
	}
	return chat;
}

/** 接続ボタンを持つ Webview フレームを探す。 */
async function findConnectFrame(page, chat) {
	for (const frame of page.frames()) {
		if (await frame.getByRole("button", { name: "接続する" }).count()) {
			chat = frame;
			break;
		}
	}
	return chat;
}
