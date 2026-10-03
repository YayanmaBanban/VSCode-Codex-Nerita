// 展開した配布物を実際の Extension Host で有効化し、公開コマンドと SDK の動的読み込みを確認する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const vscode = require("vscode");

/** 開発用拡張へ戻らず、今回の展開物を起動する。 */
async function run() {
	const root = process.env.NERITA_DISTRIBUTION_TEST_EXTENSION;
	assert.ok(root);
	const manifest = JSON.parse(
		await fs.readFile(path.join(root, "package.json"), "utf8"),
	);
	const extension = vscode.extensions.getExtension(
		`${manifest.publisher}.${manifest.name}`,
	);
	assert.ok(extension);
	assert.equal(
		await fs.realpath(extension.extensionPath),
		await fs.realpath(root),
	);
	await extension.activate();
	assert.equal(extension.isActive, true);
	const commands = await vscode.commands.getCommands(true);
	for (const command of manifest.contributes.commands) {
		assert.ok(commands.includes(command.command), command.command);
	}
	const sdk = await import(
		pathToFileURL(path.join(root, "dist/runtime/pi.mjs")).href
	);
	assert.equal(typeof sdk.createAgentSession, "function");
	for (const asset of ["dist/webview/index.js", "dist/webview/index.css"]) {
		assert.ok((await fs.stat(path.join(root, asset))).size > 0);
	}
	console.log("展開 VSIX の有効化・公開コマンド・SDK 読込み: 成功");
	if (process.env.NERITA_UI_MODEL) {
		await require("./webview.cjs").run();
	}
}

module.exports = { run };
