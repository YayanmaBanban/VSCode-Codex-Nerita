// 隔離した VS Code にインストールした VSIX から実際の会話を検証する。
import { _electron as electron } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve("dist/installed-smoke");
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
		.fill(">Codex ACP: チャットを開く");
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
		for (const frame of page.frames()) {
			if (await frame.getByRole("button", { name: "接続する" }).count()) {
				chat = frame;
				break;
			}
		}
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
			"Reply with exactly ACP_INSTALLED_OK. Do not use tools or modify files.",
		);
	await chat.getByRole("button", { name: "送信 ↑" }).click();
	await chat
		.locator(".message.assistant")
		.getByText("ACP_INSTALLED_OK", { exact: true })
		.waitFor({ timeout: 90000 });
	await chat.getByText("完了", { exact: true }).waitFor();
	await page.screenshot({ path: path.join(root, "conversation.png") });
	await page.keyboard.press("F1");
	await page
		.locator(".quick-input-widget input")
		.fill(">View: Show Explorer");
	await page.keyboard.press("Enter");
	await page.keyboard.press("F1");
	await page
		.locator(".quick-input-widget input")
		.fill(">Codex ACP: チャットを開く");
	await page.keyboard.press("Enter");
	for (let attempt = 0; attempt < 100; attempt++) {
		const candidates = page.frames();
		for (const frame of candidates) {
			if (await frame.locator("textarea#prompt").count()) {
				chat = frame;
				break;
			}
		}
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
		.getByText("ACP_INSTALLED_OK", { exact: true })
		.waitFor();
	await chat
		.getByRole("textbox")
		.fill("Count from 1 to 10000. Do not use tools or modify files.");
	await chat.getByRole("button", { name: "送信 ↑" }).click();
	await chat.getByRole("button", { name: "■ 停止" }).click();
	await chat
		.getByText("停止しました", { exact: true })
		.waitFor({ timeout: 15000 });
	await page.screenshot({ path: path.join(root, "cancelled.png") });
	await chat.getByRole("button", { name: "接続する" }).click();
	await chat
		.getByText("接続済み", { exact: true })
		.waitFor({ timeout: 60000 });
	await chat.getByText("ここから、一緒に。", { exact: true }).waitFor();
	console.log(
		"Installed VSIX: reply, restored conversation, cancellation and reconnection verified",
	);
} catch (error) {
	const page = await app.firstWindow();
	await page.screenshot({ path: path.join(root, "failure.png") });
	throw error;
} finally {
	await app.close();
}
