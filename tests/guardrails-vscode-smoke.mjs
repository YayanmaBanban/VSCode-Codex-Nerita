// 専用プロファイルの実 VS Code で、設定の作成・検査・適用・再起動後の復元を確認する。
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";

const root = process.cwd();
const output = path.join(root, "dist/guardrails-vscode");
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
	/** コマンドパレットから本番のコマンドを呼ぶ。 */
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
	/** 新しい Webview の起動完了を画面で確認する。 */
	async function editorFrame() {
		let frame;
		await expect(async () => {
			for (const candidate of page.frames()) {
				if (
					await candidate
						.getByRole("heading", {
							name: "Pi ガードレール",
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
	await command("Nerita: Pi ガードレールを編集");
	let frame = await editorFrame();
	const file = path.join(workspace, ".pi/guardrails.json");
	assert.equal(JSON.parse(await readFile(file, "utf8")).version, 1);
	await frame.getByRole("button", { name: "検査", exact: true }).click();
	await expect(frame.getByText("判定: deny")).toBeVisible();
	await page.screenshot({ path: path.join(fixture, "inspection.png") });
	report.cases.push("custom-editor-created-and-inspected");
	await frame.getByLabel("対象パス / コマンド").fill("../outside.txt");
	await frame.getByRole("button", { name: "検査", exact: true }).click();
	await expect(
		frame.getByText("workspace外への読取りです。", { exact: false }),
	).toBeVisible();
	await frame.getByLabel("workspace外の読取り").selectOption("ask");
	await frame.getByRole("button", { name: "保存", exact: true }).click();
	await expect(
		frame.locator('main[data-document-status="保存済み・未適用"]'),
	).toBeVisible();
	assert.equal(
		JSON.parse(await readFile(file, "utf8")).pathAccess.outsideRead,
		"ask",
	);
	await frame.getByRole("button", { name: "適用", exact: true }).click();
	await expect(
		frame.locator('main[data-document-status="適用済み"]'),
	).toBeVisible();
	await frame.getByRole("button", { name: "検査", exact: true }).click();
	await expect(frame.getByText("判定: ask")).toBeVisible();
	await page.screenshot({ path: path.join(fixture, "applied.png") });
	report.cases.push("saved-applied-and-shared-evaluator");
	await command("Developer: Reload Window");
	await expect.poll(() => frame.isDetached()).toBe(true);
	await command("Nerita: Pi ガードレールを編集");
	frame = await editorFrame();
	await expect(
		frame.locator('main[data-document-status="適用済み"]'),
	).toBeVisible();
	await expect(frame.getByLabel("workspace外の読取り")).toHaveValue("ask");
	report.cases.push("applied-config-restored-after-reload");
	const config = JSON.parse(await readFile(file, "utf8"));
	config.pathAccess.outsideRead = "allow";
	await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
	await command("Developer: Reload Window");
	await expect.poll(() => frame.isDetached()).toBe(true);
	await command("Nerita: Pi ガードレールを編集");
	frame = await editorFrame();
	await expect(frame.getByLabel("workspace外の読取り")).toHaveValue("allow");
	await expect(
		frame.locator('main[data-document-status="保存済み・未適用"]'),
	).toBeVisible();
	await page.screenshot({
		path: path.join(fixture, "external-edit-unapplied.png"),
	});
	report.cases.push("external-edit-not-auto-applied");
	assert.deepEqual(report.errors, []);
} catch (error) {
	const page = app?.windows()[0];
	if (page) {
		await page.screenshot({ path: path.join(fixture, "failure.png") });
	}
	report.errors.push(String(error).replaceAll(fixture, "<fixture>"));
	process.exitCode = 1;
} finally {
	await app?.close();
	await writeFile(
		path.join(output, "results.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	console.log(JSON.stringify(report, null, 2));
}
