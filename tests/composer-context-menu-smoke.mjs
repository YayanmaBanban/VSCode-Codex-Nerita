// 実際のVS Code標準メニューから選択範囲を変換し、Undoと表示先を確認する。
import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const executablePath = process.env.VSCODE_EXECUTABLE ?? process.argv[2];
if (!executablePath) {
	throw new Error("VSCODE_EXECUTABLE is required");
}
const output = path.resolve("dist/composer-context-menu-smoke");
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
		`--extensionDevelopmentPath=${process.cwd()}`,
		"--skip-welcome",
		"--skip-release-notes",
		"--disable-workspace-trust",
		"--disable-updates",
		"--locale=en",
		process.cwd(),
	],
});
try {
	const window = await app.firstWindow();
	await window.waitForSelector(".monaco-workbench");
	await window.keyboard.press("F1");
	await window
		.locator(".quick-input-widget input")
		.fill(">Codex ACP: チャットを開く");
	await window
		.locator(".quick-input-list")
		.getByText("Codex ACP: チャットを開く", { exact: true })
		.click({ timeout: 3000 })
		.catch(() => undefined);
	// 前回のサイドバー復元がパレットを閉じた場合も、実際の入力欄で起動を判定する。
	let chat;
	await expect
		.poll(
			async () => {
				chat = undefined;
				for (const frame of window.frames()) {
					if (
						await frame
							.getByRole("textbox", {
								name: "Codexへのメッセージ",
							})
							.count()
					) {
						chat = frame;
						return true;
					}
				}
				return false;
			},
			{ timeout: 30000 },
		)
		.toBe(true);
	const input = chat.getByRole("textbox", { name: "Codexへのメッセージ" });
	await input.fill("前文選択する本文後文");
	const position = await input.evaluate((node) => {
		const text = globalThis.document
			.createTreeWalker(node, globalThis.NodeFilter.SHOW_TEXT)
			.nextNode();
		const range = globalThis.document.createRange();
		range.setStart(text, 2);
		range.setEnd(text, 8);
		const selection = globalThis.window.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
		globalThis.document.dispatchEvent(new Event("selectionchange"));
		const selected = range.getBoundingClientRect();
		const bounds = node.getBoundingClientRect();
		return {
			x: selected.left - bounds.left + 5,
			y: selected.top - bounds.top + 5,
		};
	});
	await input.click({ button: "right", position });
	const convert = window.getByRole("menuitem", {
		name: "コードブロック化",
		exact: true,
	});
	await expect(convert).toBeVisible();
	await window.screenshot({ path: path.join(output, "native-menu.png") });
	await convert.click();
	await expect(input.locator("pre")).toHaveText("選択する本文");
	await expect(input.locator("p").first()).toHaveText("前文");
	await expect(input.locator("p").last()).toHaveText("後文");
	await window.screenshot({ path: path.join(output, "converted.png") });
	await input.press("Control+z");
	await expect(input).toHaveText("前文選択する本文後文");
	await expect(input.locator("pre")).toHaveCount(0);
	await input.press("Control+Shift+z");
	await expect(input.locator("pre")).toHaveCount(1);
	console.log(
		"Native context menu: selected text conversion and Undo/Redo passed",
	);
} catch (error) {
	for (const [index, window] of app.windows().entries()) {
		await window
			.screenshot({ path: path.join(output, `failure-${index}.png`) })
			.catch(() => undefined);
	}
	throw error;
} finally {
	await app.close();
}
