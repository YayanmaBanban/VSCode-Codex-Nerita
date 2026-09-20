// 実際のVS Codeでエディタ移動・下書き同期・サイドバー復元を検証する。
import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const executablePath = process.argv[2] ?? process.env.VSCODE_EXECUTABLE;
if (!executablePath) {
	throw new Error("VS Codeの実行ファイルを指定してください");
}
const output = path.resolve("dist/header-smoke");
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile("package.json", "utf8"));
const command = manifest.contributes.commands.find(
	(item) => item.command === "nerita.codex.openChat",
).title;
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
	const page = await app.firstWindow();
	await page.waitForSelector(".monaco-workbench");
	await page.keyboard.press("F1");
	await page.locator(".quick-input-widget input").fill(`>${command}`);
	await page
		.locator(".quick-input-list .monaco-list-row")
		.filter({ hasText: command })
		.first()
		.click();
	/** 表示先固有の操作が利用可能になるまでWebviewを探す。 */
	const findChat = async (label) => {
		let found;
		await expect
			.poll(
				async () => {
					for (const frame of page.frames()) {
						if (
							await frame
								.getByRole("button", {
									name: label,
									exact: true,
								})
								.isVisible()
								.catch(() => false)
						) {
							found = frame;
							return true;
						}
					}
					return false;
				},
				{ timeout: 30000 },
			)
			.toBe(true);
		return found;
	};
	let sidebar = await findChat("エディタグループへ移動");
	await expect(
		sidebar.getByRole("heading", { name: "新規チャット" }),
	).toHaveCSS("font-size", "12px");
	await sidebar.getByRole("textbox").fill("移動前の下書き");
	await sidebar
		.getByRole("button", { name: "エディタグループへ移動" })
		.click();
	let editor = await findChat("サイドバーへ戻る");
	await expect(editor.getByRole("textbox")).toHaveValue("移動前の下書き");
	await editor.getByRole("textbox").fill("エディタで編集した下書き");
	await page.screenshot({ path: path.join(output, "editor.png") });
	await editor.getByRole("button", { name: "サイドバーへ戻る" }).click();
	sidebar = await findChat("エディタグループへ移動");
	await expect(sidebar.getByRole("textbox")).toHaveValue(
		"エディタで編集した下書き",
	);
	await page.screenshot({ path: path.join(output, "sidebar-return.png") });
	await sidebar
		.getByRole("button", { name: "エディタグループへ移動" })
		.click();
	editor = await findChat("サイドバーへ戻る");
	await expect(editor.getByRole("textbox")).toHaveValue(
		"エディタで編集した下書き",
	);
	await page.keyboard.press("F1");
	await page
		.locator(".quick-input-widget input")
		.fill(">View: Show Explorer");
	await page
		.locator(".quick-input-list .monaco-list-row")
		.filter({ hasText: "View: Show Explorer" })
		.first()
		.click();
	await expect(editor.getByRole("textbox")).toHaveValue(
		"エディタで編集した下書き",
	);
	await editor.getByRole("button", { name: "サイドバーへ戻る" }).click();
	sidebar = await findChat("エディタグループへ移動");
	await expect(sidebar.getByRole("textbox")).toHaveValue(
		"エディタで編集した下書き",
	);
	console.log(
		"VS Code: エディタ移動・下書き同期・再表示・サイドバー復元が成功",
	);
} catch (error) {
	for (const [index, page] of app.windows().entries()) {
		await page
			.screenshot({ path: path.join(output, `failure-${index}.png`) })
			.catch(() => undefined);
	}
	throw error;
} finally {
	await app.close();
}
