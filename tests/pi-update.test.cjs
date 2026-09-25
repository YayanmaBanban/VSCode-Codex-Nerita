// Pi 更新処理の外部操作を差し替え、失敗時に後続処理を進めず、生成物も更新しないことを検証する。
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { tmpdir } = require("node:os");

/** 検証工程の失敗と、一時展開先の後片付けを隔離環境で確認する。 */
async function verify(failAt) {
	const directory = path.resolve(__dirname, "../config");
	const temporary = path.join(tmpdir(), "nerita-pi-verify-fixture");
	const commands = [];
	const removed = [];
	const cliProcess = {
		argv: ["node", "verify-pi.cjs"],
		platform: "win32",
		arch: "x64",
		env: {},
	};
	await vm.runInNewContext(
		readFileSync(path.join(directory, "verify-pi.cjs"), "utf8"),
		{
			__dirname: directory,
			process: cliProcess,
			console: { log() {}, error() {} },
			require(name) {
				if (name === "./run-pnpm.cjs") {
					return {
						runPnpm(command) {
							commands.push(Array.from(command));
							if (commands.length === failAt) {
								throw new Error("verification failed");
							}
						},
					};
				}
				if (name === "node:child_process") {
					return {
						spawnSync() {
							return { status: 0 };
						},
					};
				}
				if (name === "node:fs/promises") {
					return {
						async mkdtemp() {
							return temporary;
						},
						async lstat() {
							return {
								isSymbolicLink() {
									return false;
								},
							};
						},
						async rm(file) {
							removed.push(file);
						},
					};
				}
				return require(name);
			},
		},
	);
	return { commands, removed, exitCode: cliProcess.exitCode, temporary };
}

test("検証失敗で後続を停止し、展開後の失敗でも一時ディレクトリを削除する", async () => {
	const early = await verify(2);
	assert.equal(early.exitCode, 1);
	assert.equal(early.commands.length, 2);
	assert.deepEqual(early.removed, []);
	const extracted = await verify(6);
	assert.equal(extracted.exitCode, 1);
	assert.equal(extracted.commands.length, 6);
	assert.deepEqual(extracted.commands[5], [
		"run",
		"test:pi:chat",
		path.join(extracted.temporary, "extension"),
	]);
	assert.deepEqual(extracted.removed, [extracted.temporary]);
});

/** 依存更新・ネットワーク・書込を記録して、CLI を隔離環境で実行する。 */
async function generate({
	args = ["0.86.1"],
	installFails = false,
	aiVersion = "0.86.1",
	missingSource = false,
	httpStatus = 200,
} = {}) {
	const directory = path.resolve(__dirname, "../config");
	const writes = [];
	const cleanups = [];
	const installs = [];
	const errors = [];
	const cliProcess = { argv: ["node", "generate-pi.cjs", ...args] };
	let fetched = false;
	const fileSystem = {
		async realpath(file) {
			return file;
		},
		async readFile(file) {
			if (file.endsWith("pi-sdk-contract.json")) {
				return JSON.stringify({ sdk: { "dist/index.js": "old-hash" } });
			}
			if (file.endsWith("index.js")) {
				if (missingSource) {
					throw new Error("missing upstream file");
				}
				return "upstream source";
			}
			if (file.includes("pi-ai")) {
				return JSON.stringify({ version: aiVersion });
			}
			return JSON.stringify({
				version: "0.86.1",
				dependencies: { "@earendil-works/pi-coding-agent": "0.86.1" },
			});
		},
		async mkdir() {},
		async writeFile(file, content) {
			writes.push({ file, content });
		},
	};
	await vm.runInNewContext(
		readFileSync(path.join(directory, "generate-pi.cjs"), "utf8"),
		{
			__dirname: directory,
			Buffer,
			AbortSignal,
			process: cliProcess,
			console: {
				log() {},
				error(error) {
					errors.push(error.message);
				},
			},
			require(name) {
				if (name === "node:fs/promises") {
					return fileSystem;
				}
				if (name === "./cleanup-licenses.cjs") {
					return {
						async cleanupLicenses(...args) {
							assert.equal(writes.length, 3);
							cleanups.push(args);
						},
					};
				}
				if (name === "./run-pnpm.cjs") {
					return {
						runPnpm(command) {
							installs.push(Array.from(command));
							if (installFails) {
								throw new Error("install failed");
							}
						},
					};
				}
				return require(name);
			},
			async fetch() {
				fetched = true;
				return {
					ok: httpStatus === 200,
					status: httpStatus,
					async arrayBuffer() {
						return Buffer.from("official license\n");
					},
				};
			},
		},
	);
	return {
		writes,
		installs,
		errors,
		fetched,
		cleanups,
		exitCode: cliProcess.exitCode,
	};
}

test("依存更新・版不一致・上流欠落・HTTP失敗では生成物を更新しない", async () => {
	for (const scenario of [
		{ installFails: true },
		{ aiVersion: "0.87.0" },
		{ missingSource: true },
		{ httpStatus: 404 },
	]) {
		const result = await generate(scenario);
		assert.equal(result.exitCode, 1);
		assert.equal(result.errors.length, 1);
		assert.equal(result.writes.length, 0);
		assert.equal(result.cleanups.length, 0);
		if (scenario.httpStatus === undefined) {
			assert.equal(result.fetched, false);
		}
	}
});

test("不正な版は外部操作前に拒否し、引数なしでは依存を更新しない", async () => {
	const invalid = await generate({ args: ["latest"] });
	assert.equal(invalid.exitCode, 1);
	assert.equal(invalid.installs.length, 0);
	assert.equal(invalid.fetched, false);
	const current = await generate({ args: [] });
	assert.equal(current.exitCode, undefined);
	assert.equal(current.installs.length, 0);
	assert.equal(current.writes.length, 3);
});

test("指定版を完全固定し、公式ライセンスを改変せず保存する", async () => {
	const result = await generate();
	assert.equal(result.exitCode, undefined);
	assert.equal(result.cleanups.length, 1);
	assert.deepEqual(result.installs, [
		["add", "--save-exact", "@earendil-works/pi-coding-agent@0.86.1"],
	]);
	assert.equal(
		result.writes
			.find(({ file }) => file.endsWith("LICENSE"))
			.content.toString(),
		"official license\n",
	);
});
