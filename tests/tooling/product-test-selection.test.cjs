// バックエンド選択で別系統へ実行範囲が広がらず、一覧取得で配布物を生成しないことを確認する。
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const {
	selectProductTests,
} = require("../../config/product-test-selection.cjs");

test("Pi 専用の検証は MXC 連携を含み、Codex の履歴と共通の横断検証を含まない", async () => {
	const { files } = await selectProductTests(["--backend", "pi"]);
	assert.ok(files.includes("pi-lifecycle.test.ts"));
	assert.ok(files.includes("mxc-pi.test.ts"));
	assert.ok(!files.includes("codex-history.test.ts"));
	assert.ok(!files.includes("agent-manager.test.ts"));
});

test("Codex 専用の検証は DLC 連携を含み、Pi の検証を含まない", async () => {
	const { files } = await selectProductTests(["--backend", "codex"]);
	assert.ok(files.includes("codex-history.test.ts"));
	assert.ok(files.includes("dlc-codex-trust.test.ts"));
	assert.ok(!files.includes("pi-lifecycle.test.ts"));
	assert.ok(!files.includes("mxc-pi.test.ts"));
});

test("バックエンド指定とファイル名の絞込みを積み重ね、対象なしを成功にしない", async () => {
	const { files } = await selectProductTests([
		"--backend",
		"pi",
		"lifecycle",
	]);
	assert.deepEqual(files, ["pi-lifecycle.test.ts"]);
	await assert.rejects(
		selectProductTests(["--backend", "pi", "codex-history"]),
	);
	await assert.rejects(selectProductTests(["--backend", "unknown"]));
	await assert.rejects(selectProductTests(["--bakend", "pi"]));
});

test("全体検証は共通・両バックエンドを維持し、外部拡張は明示選択する", async () => {
	const { files } = await selectProductTests([]);
	for (const name of [
		"pi-lifecycle.test.ts",
		"codex-history.test.ts",
		"agent-manager.test.ts",
	]) {
		assert.ok(files.includes(name), name);
	}
	assert.ok(!files.includes("pi-web.external.test.ts"));
	const external = await selectProductTests([
		"--backend",
		"pi",
		"--external",
	]);
	assert.ok(external.files.includes("pi-web.external.test.ts"));
});

for (const command of ["test-products.cjs", "test-distribution.cjs"]) {
	test(`${command} の一覧表示は選択対象だけを出力し、ビルドやテストを始めない`, () => {
		const result = spawnSync(
			process.execPath,
			[
				path.resolve(__dirname, "../../config", command),
				"--backend",
				"pi",
				"lifecycle",
				"--list",
			],
			{ encoding: "utf8", windowsHide: true },
		);
		assert.ifError(result.error);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stdout.trim(), "pi-lifecycle.test.ts");
		assert.equal(result.stderr, "");
	});
}
