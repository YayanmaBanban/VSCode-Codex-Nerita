// ページの状態が共有される不具合を、隔離テストが実際に検出できることを確認する。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("検証環境: 状態を共有する不具合を隔離テストで検出する", async () => {
	const root = await fs.mkdtemp(
		path.resolve("dist/scratch-isolation-regression-"),
	);
	const source = await fs.readFile("tests/support/scratch-test.cjs", "utf8");
	const original = "const context = await browser.newContext(options);";
	assert.ok(
		source.includes(original),
		"不具合を注入する箇所が見つかりません。",
	);
	// 実際の fixture は変更せず、生成したコピーだけでページ間の context を共有させる。
	await fs.writeFile(
		path.join(root, "scratch-test.cjs"),
		source.replace(
			original,
			"const context = contexts[0] ?? (await browser.newContext(options));",
		),
	);
	const scenario = await fs.readFile(
		"tests/scratch/runner-isolation.spec.cjs",
		"utf8",
	);
	await fs.writeFile(
		path.join(root, "isolation.spec.cjs"),
		scenario.replace("../support/scratch-test.cjs", "./scratch-test.cjs"),
	);
	await fs.writeFile(
		path.join(root, "playwright.config.cjs"),
		'module.exports = { testDir: __dirname, testMatch: "*.spec.cjs", outputDir: "./output", workers: 1, use: { channel: "chrome" } };',
	);
	const cli = path.join(
		path.dirname(require.resolve("@playwright/test/package.json")),
		"cli.js",
	);
	const result = spawnSync(
		process.execPath,
		[cli, "test", "--config", path.join(root, "playwright.config.cjs")],
		{
			encoding: "utf8",
			windowsHide: true,
			timeout: 60000,
		},
	);
	assert.ifError(result.error);
	assert.equal(
		result.status,
		1,
		"状態が共有される実装では隔離テストが失敗する必要があります。",
	);
	assert.match(
		result.stdout,
		/Received:\s*"first"/,
		"起動失敗ではなく、保存状態の漏れを検出したことを確認します。",
	);
});
