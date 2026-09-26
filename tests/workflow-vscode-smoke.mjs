// 専用プロファイルの VS Code で、Workflow 文書の作成・保存・再表示を確認する。
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import { parse } from "smol-toml";

const root = process.cwd();
const output = path.join(root, "dist/workflow-vscode");
await mkdir(output, { recursive: true });
const fixture = await mkdtemp(path.join(output, "run-"));
const profile = path.join(fixture, "profile");
const workspace = path.join(fixture, "workspace");
await mkdir(path.join(profile, "User"), { recursive: true });
await mkdir(workspace);
await writeFile(
	path.join(profile, "User/settings.json"),
	JSON.stringify({
		"security.workspace.trust.enabled": false,
		"workbench.startupEditor": "none",
		"window.restoreWindows": "none",
		"git.enabled": false,
		"files.eol": "\r\n",
	}),
);
const report = {
	cases: [],
	errors: [],
	artifacts: path.relative(root, fixture).replaceAll("\\", "/"),
};
let app;
try {
	app = await electron.launch({
		executablePath:
			process.env.VSCODE_EXECUTABLE ??
			path.join(
				process.env.LOCALAPPDATA,
				"Programs/Microsoft VS Code/Code.exe",
			),
		args: [
			`--user-data-dir=${profile}`,
			`--extensions-dir=${path.join(fixture, "extensions")}`,
			`--extensionDevelopmentPath=${root}`,
			"--disable-extensions",
			"--skip-welcome",
			"--skip-release-notes",
			workspace,
		],
		timeout: 30000,
	});
	const page = await app.firstWindow();
	page.setDefaultTimeout(15000);
	page.on("pageerror", (error) => report.errors.push(error.message));
	page.on("console", (message) => {
		if (
			message.type() === "error" &&
			message.location().url.startsWith("vscode-webview:")
		) {
			report.errors.push(message.text());
		}
	});
	await page.locator(".monaco-workbench").waitFor();
	/** コマンドパレットから本番の登録コマンドを実行する。 */
	async function command(title) {
		await expect(async () => {
			await page.keyboard.press("F1");
			await expect(page.locator(".quick-input-widget input")).toBeVisible(
				{ timeout: 1000 },
			);
		}).toPass({ timeout: 15000 });
		await page.locator(".quick-input-widget input").fill(`>${title}`);
		await expect(page.locator(".quick-input-list")).toContainText(title);
		await page.keyboard.press("Enter");
	}
	/** ネストした Webview から、専用エディタのフレームを見つける。 */
	async function editorFrame() {
		let frame;
		await expect(async () => {
			for (const candidate of page.frames()) {
				if (
					await candidate
						.getByRole("heading", {
							name: "Pi Workflow",
							exact: true,
						})
						.count()
				) {
					frame = candidate;
				}
			}
			assert.ok(frame);
		}).toPass({ timeout: 20000 });
		return frame;
	}
	await command("Nerita: Pi Workflow を作成");
	await expect(page.locator(".quick-input-widget")).toContainText(
		"Workflow のファイル名",
	);
	await page.keyboard.press("Enter");
	let frame = await editorFrame();
	const file = path.join(workspace, ".pi/workflows/workflow.toml");
	assert.equal(parse(await readFile(file, "utf8")).version, 1);
	await frame.getByRole("button", { name: "＋ ステップを追加" }).click();
	await frame
		.getByRole("textbox", { name: "タスク", exact: true })
		.fill("VS Code で編集したタスク");
	await frame.getByRole("button", { name: "保存", exact: true }).click();
	await expect(
		frame.getByText("保存しました。", { exact: true }),
	).toBeVisible();
	assert.equal(
		parse(await readFile(file, "utf8")).steps[1].task,
		"VS Code で編集したタスク",
	);
	report.cases.push("created-edited-and-saved");
	await frame.getByRole("button", { name: "検証", exact: true }).click();
	await expect(
		frame.getByText("TOML と依存関係を検証しました。", { exact: false }),
	).toBeVisible();
	await page.screenshot({ path: path.join(fixture, "graph.png") });
	await frame.getByRole("switch", { name: "TOML 編集" }).click();
	await frame
		.getByRole("textbox", { name: "Workflow TOML", exact: true })
		.fill("version = [");
	await frame.getByRole("button", { name: "検証", exact: true }).click();
	await expect(frame.getByRole("alert")).toBeVisible();
	const saved = await readFile(file, "utf8");
	await frame
		.getByRole("textbox", { name: "Workflow TOML", exact: true })
		.fill(saved);
	await frame.getByRole("button", { name: "保存", exact: true }).click();
	await expect(
		frame.getByText("保存しました。", { exact: true }),
	).toBeVisible();
	report.cases.push("invalid-toml-recovered");
	await command("Developer: Reload Window");
	await expect.poll(() => frame.isDetached()).toBe(true);
	frame = await editorFrame();
	await expect(frame.locator(".react-flow__node")).toHaveCount(2);
	await frame.getByRole("button", { name: "実行", exact: true }).click();
	await expect(frame.getByRole("alert")).toContainText(
		"Pi バックエンドへ接続してください。",
	);
	report.cases.push("reopened-and-unavailable-backend-rejected");
	await page.screenshot({ path: path.join(fixture, "reopened.png") });
	assert.deepEqual(report.errors, []);
} finally {
	await writeFile(
		path.join(fixture, "report.json"),
		JSON.stringify(report, null, 2),
	);
	await app?.close();
}
console.log(JSON.stringify(report, null, 2));
