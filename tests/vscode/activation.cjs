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
	assert.ok(!commands.includes("nerita.pi.setupCodexWindowsSandbox"));
	for (const command of manifest.contributes.commands) {
		assert.ok(commands.includes(command.command), command.command);
	}
	const sdk = await import(
		pathToFileURL(path.join(root, "dist/runtime/pi.mjs")).href
	);
	assert.equal(typeof sdk.createAgentSession, "function");
	await verifyMxcRuntime(root);
	for (const asset of ["dist/webview/index.js", "dist/webview/index.css"]) {
		assert.ok((await fs.stat(path.join(root, asset))).size > 0);
	}
	console.log("展開 VSIX の有効化・公開コマンド・SDK 読込み: 成功");
	if (process.env.NERITA_UI_MODEL) {
		await require("./webview.cjs").run();
	}
}

module.exports = { run };

/** 開発端末の Node ではなく、配布先の Extension Host とネイティブ依存の互換性を確認する。 */
async function verifyMxcRuntime(root) {
	assert.ok(
		Number(process.versions.node.split(".")[0]) >= 24,
		`MXC requires Node 24; Extension Host: ${process.versions.node}`,
	);
	const mxc = await import(
		pathToFileURL(
			path.join(
				root,
				"dist/runtime/node_modules/@microsoft/mxc-sdk/dist/index.js",
			),
		).href
	);
	assert.equal(typeof mxc.spawnSandboxFromConfig, "function");
	const support = mxc.getPlatformSupport();
	assert.equal(typeof support.isSupported, "boolean");
	const diagnosis = await vscode.commands.executeCommand(
		"nerita.pi.checkMxcSandbox",
	);
	assert.equal(diagnosis.id, "mxc");
	assert.equal(typeof diagnosis.available, "boolean");
	if (
		support.isSupported &&
		support.availableMethods.includes("processcontainer")
	) {
		assert.equal(diagnosis.available, true, diagnosis.reason);
	}
	if (!diagnosis.available) {
		assert.ok(diagnosis.reason);
	}
	console.log(`MXC 実起動診断: ${JSON.stringify(diagnosis)}`);
	console.log(
		`MXC SDK 読込み: Node ${process.versions.node}, isolation ${support.isolationTier ?? "unavailable"}`,
	);
}
