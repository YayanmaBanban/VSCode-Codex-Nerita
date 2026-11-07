// 専用 VS Code で個人情報タブを保存・再表示し、ワークスペースの JSON へ設定だけが保存されることを確認する。
// 実行時に `NERITA_UI_ACCEPTANCE_ENTRY` へこのファイルを指定し、`pnpm test:webview pi-egress guardrails-save` を使う。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, expect } = require("@playwright/test");
const vscode = require("vscode");
const { findFrame, collectWebviewErrors } = require("./webview.cjs");

/** 表示は実際の UI、設定の永続化は生成されたファイルで確認する。 */
async function run() {
	const root = process.env.NERITA_DISTRIBUTION_TEST_EXTENSION;
	const manifest = require(path.join(root, "package.json"));
	await vscode.extensions
		.getExtension(`${manifest.publisher}.${manifest.name}`)
		.activate();
	const port = (
		await fs.readFile(
			path.join(process.env.NERITA_UI_PROFILE, "DevToolsActivePort"),
			"utf8",
		)
	).split("\n")[0];
	const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
	const page = browser.contexts()[0].pages()[0];
	const errors = [];
	try {
		await page
			.context()
			.tracing.start({ screenshots: true, snapshots: true });
		collectWebviewErrors(page, errors);
		await verifyPrivacySettings(page);
		assert.deepEqual(errors, []);
		console.log("個人情報設定の JSON 保存・再表示とモデルのオフ固定: 成功");
	} finally {
		await page.screenshot({
			path: path.join(
				process.env.NERITA_UI_ARTIFACTS,
				"privacy-settings.png",
			),
		});
		await page.context().tracing.stop({
			path: path.join(
				process.env.NERITA_UI_ARTIFACTS,
				"privacy-trace.zip",
			),
		});
		await browser.close();
	}
}

module.exports = { run };

/** 個人情報タブだけを独立して操作し、保存した設定を再表示で復元する。 */
async function verifyPrivacySettings(page) {
	await vscode.commands.executeCommand("nerita.pi.guardrails");
	const frame = await findFrame(page, "main.guardrails-editor");
	await frame
		.getByRole("button", { name: "個人情報の送信", exact: true })
		.click();
	const enabled = frame.getByRole("checkbox", {
		name: "送信前の個人情報検査",
	});
	await expect(enabled).toBeChecked();
	const model = frame.getByRole("checkbox", {
		name: "PII 検出モデルの利用",
	});
	await expect(model).not.toBeChecked();
	await expect(model).toBeDisabled();
	await enabled.uncheck();
	const save = frame.getByRole("button", {
		name: "保存して適用",
		exact: true,
	});
	await expect(save).toBeEnabled();
	await save.click();
	await expect(frame.locator("main")).toHaveAttribute(
		"data-document-status",
		"適用済み",
	);
	const cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
	const config = JSON.parse(
		await fs.readFile(path.join(cwd, ".pi/guardrails.json"), "utf8"),
	);
	assert.deepEqual(config.privacy, {
		enabled: false,
		usePiiModel: false,
	});
	await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
	await vscode.commands.executeCommand("nerita.pi.guardrails");
	const reopened = await findFrame(page, "main.guardrails-editor");
	await reopened
		.getByRole("button", { name: "個人情報の送信", exact: true })
		.click();
	await expect(
		reopened.getByRole("checkbox", { name: "送信前の個人情報検査" }),
	).not.toBeChecked();
	await expect(
		reopened.getByRole("checkbox", { name: "PII 検出モデルの利用" }),
	).toBeDisabled();
}
