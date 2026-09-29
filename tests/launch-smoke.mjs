// F5 と同じデバッグ開始操作でフォルダーが開かれ、Webview から接続できることを検証する。
import { repoRoot } from "../config/workspace-paths.cjs";
import { _electron as electron } from "playwright";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { checkLaunchWebview } from "./launch-webview-checks.mjs";
import { openCommand } from "./fixtures/openCommand.mjs";
const executablePath = process.env.VSCODE_EXECUTABLE;
if (!executablePath) {
	throw new Error("VSCODE_EXECUTABLE is required");
}
const outputRoot = path.resolve("dist/launch-smoke");
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(path.join(outputRoot, "run-"));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
	executablePath,
	env,
	timeout: 30000,
	args: [
		`--user-data-dir=${path.join(output, "profile")}`,
		`--extensions-dir=${path.join(output, "extensions")}`,
		"--skip-welcome",
		"--skip-release-notes",
		"--disable-workspace-trust",
		"--disable-updates",
		"--locale=en",
		repoRoot,
	],
});
try {
	const parent = await app.firstWindow();
	await parent.waitForSelector(".monaco-workbench");
	await parent.keyboard.press("Control+Shift+D");
	await parent.getByText("Run Extension", { exact: true }).waitFor();
	await parent.bringToFront();
	// 起動タスクを含め、利用者と同じ F5 経路を通す。
	const opened = app.waitForEvent("window", { timeout: 90000 });
	void opened.catch(() => undefined);
	await parent.locator(".codicon-debug-start").first().click();
	await parent.screenshot({ path: path.join(output, "after-f5.png") });
	console.log("Run Extension started");
	const child = await opened;
	await child.waitForSelector(".monaco-workbench", { timeout: 30000 });
	await child.screenshot({ path: path.join(output, "opened.png") });
	await openCommand(child, "Nerita: チャットを開く");
	let chat;
	for (let attempt = 0; attempt < 100; attempt++) {
		chat = await findChatFrame(child, chat);
		if (chat) {
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	if (!chat) {
		throw new Error("Chat view not found");
	}
	const connect = chat.getByRole("button", { name: "接続する", exact: true });
	if (await connect.count()) {
		await connect.click();
	}
	await chat
		.getByText("接続済み", { exact: true })
		.waitFor({ timeout: 60000 });
	await child.screenshot({ path: path.join(output, "connected.png") });
	await checkLaunchWebview(chat, child, output);
	console.log("F5 launch: workspace opened and App Server connection ready");
} catch (error) {
	for (const [index, page] of app.windows().entries()) {
		await page
			.screenshot({ path: path.join(output, `failure-${index}.png`) })
			.catch(() => undefined);
		console.log(`Window ${index}: ${await page.title()}`);
	}
	throw error;
} finally {
	await app.close();
}

/** 自動接続の完了後も、入力欄からデバッグ先のフレームを見つける。 */
async function findChatFrame(child, chat) {
	for (const frame of child.frames()) {
		if (
			await frame
				.getByRole("textbox", { name: /(?:Codex|Pi)へのメッセージ/ })
				.count()
		) {
			chat = frame;
			break;
		}
	}
	return chat;
}
