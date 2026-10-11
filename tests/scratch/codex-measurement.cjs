// node tests/scratch/codex-measurement.cjs で同梱 Codex を実測する。--smoke は各構成1組。
// 製品コードの計測用コピーへ時刻だけを挿入し、専用の Worktree を終了時に回収する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { build } = require("esbuild");
const { repoRoot } = require("../../config/workspace-paths.cjs");

async function main() {
	assert.equal(process.platform, "win32");
	assert.equal(process.arch, "x64");
	const temporary = await fs.mkdtemp(
		path.join(os.tmpdir(), "nerita-codex-measurement-"),
	);
	const source = await sourceVersions();
	try {
		const output = path.join(temporary, "measurement.cjs");
		await build({
			absWorkingDir: repoRoot,
			entryPoints: ["tests/scratch/codex-measurement.ts"],
			outfile: output,
			bundle: true,
			platform: "node",
			format: "cjs",
			target: "node24",
			conditions: ["nerita-source"],
			plugins: [instrumentation()],
		});
		const { measure, recover } = require(output);
		if (process.argv[2] === "--recover") {
			assert.match(
				process.argv[3],
				/^nerita-codex-measurement-[a-z\d]+$/i,
			);
			await recover(
				path.join(repoRoot, "apps/vscode-nerita"),
				path.join(os.tmpdir(), process.argv[3], "case-1-false/main"),
			);
			return;
		}
		const result = await measure(
			temporary,
			path.join(repoRoot, "apps/vscode-nerita"),
			process.argv.includes("--smoke") ? 1 : 5,
		);
		assert.deepEqual(
			await sourceVersions(),
			source,
			"計測中に使用ソースが変更されました。",
		);
		const destination = path.join(
			repoRoot,
			"dist/measurements",
			new Date().toISOString().replaceAll(":", "-"),
		);
		await fs.mkdir(destination, { recursive: true });
		await fs.writeFile(
			path.join(destination, "codex.json"),
			JSON.stringify({ ...result, source }, null, 2),
		);
		console.log(
			`計測結果: ${path.relative(repoRoot, destination)}/codex.json`,
		);
		console.log(
			JSON.stringify(
				result.summary.map((group) => ({
					cache: group.persistentCache,
					phase: group.phase,
					count: group.count,
					failureCount: group.failureCount,
					attemptCount: group.attemptCount,
					cacheHits: group.cacheHits,
					commandMs: group.metrics.commandMs,
					startupToCommandMs: group.metrics.startupToCommandMs,
				})),
				null,
				2,
			),
		);
	} finally {
		assert.equal(path.dirname(temporary), os.tmpdir());
		assert.ok(
			path.basename(temporary).startsWith("nerita-codex-measurement-"),
		);
		assert.equal((await fs.lstat(temporary)).isSymbolicLink(), false);
		await fs.rm(temporary, { recursive: true, force: true });
	}
}

function instrumentation() {
	return {
		name: "codex-numeric-measurement",
		setup(builder) {
			const instrumentCodexModule = async ({ path: filename }) => {
				let content = await fs.readFile(filename, "utf8");
				const hooks = path.join(
					repoRoot,
					"tests/scratch/codex-measurement-support.ts",
				);
				content = `import { mark, recordProcess } from ${JSON.stringify(hooks)};\n${content}`;
				const replacements = [
					[
						"\t\tconst child = startAppServerProcess(",
						'\t\tmark("resolved");\n\t\tconst child = startAppServerProcess(',
					],
					[
						"\t\tlet transport: AppServerTransport;",
						"\t\trecordProcess(child);\n\t\tlet transport: AppServerTransport;",
					],
					[
						'\t\t\tconst response = await transport.request("initialize", {',
						'\t\t\tmark("transportReady");\n\t\t\tconst response = await transport.request("initialize", {',
					],
					[
						'\t\t\ttransport.notify({ method: "initialized" });',
						'\t\t\tmark("initialized");\n\t\t\ttransport.notify({ method: "initialized" });',
					],
				];
				for (const [before, after] of replacements) {
					assert.equal(
						content.split(before).length,
						2,
						"Codex の計測位置が変わりました。",
					);
					content = content.replace(before, after);
				}
				return { contents: content, loader: "ts" };
			};
			builder.onLoad(
				{ filter: /[/\\]CodexClient\.ts$/ },
				instrumentCodexModule,
			);
		},
	};
}

async function sourceVersions() {
	const base = "apps/vscode-nerita/src/extension/backends/codex/";
	const binary =
		"apps/vscode-nerita/dist/runtime/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe";
	const resources = path.posix.join(
		path.posix.dirname(binary),
		"../codex-resources",
	);
	const files = [
		...[
			"CodexClient.ts",
			"runtime/executable.ts",
			"runtime/AppServerProcess.ts",
			"runtime/AppServerTransport.ts",
			"runtime/AppServerJsonReader.ts",
			"runtime/AppServerJsonWorker.ts",
			"settings/PersonalityStore.ts",
		].map((file) => base + file),
		"apps/vscode-nerita/src/extension/runtime/CommandEnvironment.ts",
		"apps/vscode-nerita/src/extension/dlc/WorktreeManager.ts",
		"tests/scratch/codex-measurement.cjs",
		"tests/scratch/codex-measurement.ts",
		"tests/scratch/codex-measurement-support.ts",
		binary,
		`${resources}/codex-command-runner.exe`,
		`${resources}/codex-windows-sandbox-setup.exe`,
	];
	const hashes = {};
	for (const file of files) {
		const hash = createHash("sha256");
		for await (const chunk of createReadStream(path.join(repoRoot, file))) {
			hash.update(chunk);
		}
		hashes[file] = hash.digest("hex");
	}
	const manifest = JSON.parse(
		await fs.readFile(
			path.join(
				repoRoot,
				"apps/vscode-nerita/dist/runtime/node_modules/@openai/codex/package.json",
			),
			"utf8",
		),
	);
	const commit = spawnSync("git", ["rev-parse", "HEAD"], {
		cwd: repoRoot,
		encoding: "utf8",
		windowsHide: true,
	});
	assert.equal(commit.status, 0);
	return {
		head: commit.stdout.trim(),
		codexVersion: manifest.version,
		hashes,
	};
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
