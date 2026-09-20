// F5と同じデバッグ開始操作でフォルダーが開かれ、Webviewから接続できることを検証する。
import { _electron as electron } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { checkLaunchWebview } from "./launch-webview-checks.mjs";
const executablePath = process.env.VSCODE_EXECUTABLE;
if (!executablePath) {
	throw new Error("VSCODE_EXECUTABLE is required");
}
const output = path.resolve("dist/launch-smoke");
await mkdir(output, { recursive: true });
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
		process.cwd(),
	],
});
try {
	const parent = await app.firstWindow();
	await parent.waitForSelector(".monaco-workbench");
	await parent.keyboard.press("Control+Shift+D");
	await parent.getByText("Run Extension", { exact: true }).waitFor();
	await parent.bringToFront();
	// 起動タスクを含め、利用者と同じF5経路を通す。
	const opened = app.waitForEvent("window", { timeout: 90000 });
	void opened.catch(() => undefined);
	await parent.locator(".codicon-debug-start").first().click();
	await parent.screenshot({ path: path.join(output, "after-f5.png") });
	console.log("Run Extension started");
	const child = await opened;
	await child.waitForSelector(".monaco-workbench", { timeout: 30000 });
	await child.screenshot({ path: path.join(output, "opened.png") });
	await child.keyboard.press("F1");
	await child
		.locator(".quick-input-widget input")
		.fill(">Nerita for Codex: チャットを開く");
	await child.keyboard.press("Enter");
	let chat;
	for (let attempt = 0; attempt < 100; attempt++) {
		for (const frame of child.frames()) {
			if (await frame.getByRole("button", { name: "接続する" }).count()) {
				chat = frame;
				break;
			}
		}
		if (chat) {
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	if (!chat) {
		throw new Error("Chat view not found");
	}
	await chat.getByRole("button", { name: "接続する" }).click();
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
