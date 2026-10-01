// テスト用プロセスの起動と、自分で確保した一時領域の回収を共通化する。
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { repoRoot } = require("./workspace-paths.cjs");

/** 呼出側の終了経路にかかわらず、実行専用の領域だけを回収する。 */
async function withTestDirectory(operation) {
	const directory = await mkdtemp(path.join(tmpdir(), "nerita-test-run-"));
	try {
		return await operation(directory);
	} finally {
		await removeTestDirectory(directory);
	}
}

/** 一時領域の直下であることを確認してから再帰削除する。 */
async function removeTestDirectory(directory) {
	if (
		path.dirname(path.resolve(directory)) !== path.resolve(tmpdir()) ||
		!path.basename(directory).startsWith("nerita-test-run-")
	) {
		throw new Error("Unexpected test directory");
	}
	await rm(directory, { recursive: true, force: true, maxRetries: 5 });
}

/** 起動失敗と時間切れはテスト結果として扱わず、呼出側へ返す。 */
function runVitest(args, env, capture = false) {
	const result = spawnSync(
		process.execPath,
		[
			path.join(
				path.dirname(require.resolve("vitest/package.json")),
				"vitest.mjs",
			),
			"run",
			"--config",
			"config/vitest.host.config.ts",
			...args,
		],
		{
			cwd: repoRoot,
			env,
			stdio: capture ? "pipe" : "inherit",
			encoding: "utf8",
			windowsHide: true,
			timeout: 180000,
			maxBuffer: 16 * 1024 * 1024,
		},
	);
	if (result.error) {
		throw result.error;
	}
	return result;
}

module.exports = { withTestDirectory, runVitest };
