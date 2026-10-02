// 生成コマンドの引数とレジストリ応答を、依存を更新しない別プロセスで検証する。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test, after } = require("node:test");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "nerita-generate-version-"));
const runner = path.join(root, "runner.cjs");
const pnpm = path.join(root, "pnpm.cjs");
const calls = path.join(root, "calls.jsonl");
fs.writeFileSync(
	runner,
	`const { readRequestedVersion } = require(process.env.NERITA_VERSION_MODULE);
console.log(JSON.stringify({ version: readRequestedVersion(process.env.NERITA_PACKAGE, process.env.NERITA_COMMAND) }));`,
);
fs.writeFileSync(
	pnpm,
	`require("node:fs").appendFileSync(process.env.NERITA_CALLS, JSON.stringify(process.argv.slice(2)) + "\\n");
process.stdout.write(process.env.NERITA_RESPONSE);
process.exitCode = Number(process.env.NERITA_STATUS);`,
);

after(() => {
	if (
		path.dirname(root) !== os.tmpdir() ||
		!path.basename(root).startsWith("nerita-generate-version-") ||
		fs.lstatSync(root).isSymbolicLink()
	) {
		throw new Error("検証用の一時領域を確認できません。");
	}
	fs.rmSync(root, { recursive: true, force: true });
});

/** pnpm のレジストリ照会の応答と終了コードを置き換え、CLI の結果を取得する。 */
function execute(packageName, command, args, response = '"1.2.3"', status = 0) {
	fs.writeFileSync(calls, "");
	const result = spawnSync(process.execPath, [runner, ...args], {
		encoding: "utf8",
		windowsHide: true,
		env: {
			...process.env,
			npm_execpath: pnpm,
			npm_config_user_agent: "pnpm/10.0.0",
			NERITA_VERSION_MODULE: path.resolve(
				__dirname,
				"../../config/generate-version.cjs",
			),
			NERITA_PACKAGE: packageName,
			NERITA_COMMAND: command,
			NERITA_CALLS: calls,
			NERITA_RESPONSE: response,
			NERITA_STATUS: String(status),
		},
	});
	assert.ifError(result.error);
	return {
		...result,
		calls: fs
			.readFileSync(calls, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map(JSON.parse),
	};
}

for (const [packageName, command] of [
	["@earendil-works/pi-coding-agent", "pi:generate"],
	["@openai/codex", "codex:generate"],
]) {
	test(`${command}: 引数なしと指定版ではレジストリを問い合わせない`, () => {
		for (const [args, version] of [
			[[], undefined],
			[["1.2.3"], "1.2.3"],
			[["1.2.3-beta.1"], "1.2.3-beta.1"],
		]) {
			const result = execute(packageName, command, args);
			assert.equal(result.status, 0, result.stderr);
			assert.deepEqual(
				JSON.parse(result.stdout),
				version === undefined ? {} : { version },
			);
			assert.deepEqual(result.calls, []);
		}
	});

	test(`${command}: --latest は latest タグを一度だけ具体的な版へ解決する`, () => {
		for (const args of [["--latest"], ["--", "--latest"]]) {
			const result = execute(packageName, command, args);
			assert.equal(result.status, 0, result.stderr);
			assert.deepEqual(
				JSON.parse(result.stdout.trim().split("\n").at(-1)),
				{ version: "1.2.3" },
			);
			assert.deepEqual(result.calls, [
				["view", packageName, "dist-tags.latest", "--json"],
			]);
		}
	});

	test(`${command}: 不正な引数は問い合わせ前に拒否する`, () => {
		for (const args of [
			["--unknown"],
			["latest"],
			["--latest", "1.2.3"],
			["1.2.3", "--latest"],
		]) {
			const result = execute(packageName, command, args);
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /使い方:/);
			assert.deepEqual(result.calls, []);
		}
	});

	test(`${command}: latest の取得失敗と不正な応答を成功扱いにしない`, () => {
		for (const [response, status] of [
			['"1.2.3"', 1],
			["{}", 0],
			['"latest"', 0],
			["not-json", 0],
		]) {
			const result = execute(
				packageName,
				command,
				["--latest"],
				response,
				status,
			);
			assert.notEqual(result.status, 0);
		}
	});
}
