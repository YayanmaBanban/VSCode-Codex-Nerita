// 承認待ち・ランチャー・MXC・固定コマンドを分けて測る。node tests/scratch/mxc-measurement.cjs で実行する。
// 成果物だけを dist/measurements/ に残し、SDK・Worktree・キャッシュは検証専用領域で回収する。
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { build } = require("esbuild");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { bundlePi } = require("../../config/package-pi.cjs");
const { packageMxc } = require("../../config/package-mxc.cjs");
const { repoRoot } = require("../../config/workspace-paths.cjs");

async function main() {
	if (process.platform !== "win32" || process.arch !== "x64") {
		throw new Error("Windows x64 上の MXC 本体で実行してください。");
	}
	const temporary = await fs.mkdtemp(
		path.join(os.tmpdir(), "nerita-measurement-"),
	);
	try {
		const baseline =
			process.argv[2] === "--compare"
				? await fs.readFile(
						path.resolve(repoRoot, process.argv[3]),
						"utf8",
					)
				: "";
		await fs.writeFile(path.join(temporary, "baseline.ps1"), baseline);
		const initialized = spawnSync("git", ["init", "--quiet", temporary], {
			windowsHide: true,
			encoding: "utf8",
		});
		if (initialized.error || initialized.status !== 0) {
			throw initialized.error ?? new Error(initialized.stderr);
		}
		const extension = path.join(temporary, "extension");
		await bundlePi(repoRoot, path.join(extension, "dist/runtime"));
		await packageMxc(path.join(extension, "dist/runtime"));
		const output = path.join(temporary, "measurement.cjs");
		await build({
			absWorkingDir: repoRoot,
			entryPoints: ["tests/scratch/mxc-measurement.ts"],
			outfile: output,
			bundle: true,
			platform: "node",
			format: "cjs",
			target: "node24",
			conditions: ["nerita-source"],
		});
		const destination = path.join(
			repoRoot,
			"dist/measurements",
			new Date().toISOString().replaceAll(":", "-"),
		);
		await fs.mkdir(destination, { recursive: true });
		// koffi の DLL は Node が終了するまでアンロードされない。計測を別プロセスに閉じ込める。
		const child = spawnSync(
			process.execPath,
			[__filename, "--child", temporary, extension, output, destination],
			{ stdio: "inherit", windowsHide: true },
		);
		if (child.error || child.status !== 0) {
			throw child.error ?? new Error("計測プロセスが失敗しました。");
		}
		await finishResult(destination, baseline);
	} finally {
		await cleanup(temporary);
	}
}

async function cleanup(temporary) {
	const unsafeTemporary =
		path.dirname(temporary) !== os.tmpdir() ||
		!path.basename(temporary).startsWith("nerita-measurement-") ||
		(await fs.lstat(temporary)).isSymbolicLink();
	if (unsafeTemporary) {
		throw new Error("計測用一時領域を確認できません。");
	}
	await fs.rm(temporary, { recursive: true, force: true });
}

/** 比較したソースも成果物へ残し、結果を変更後のソースと取り違えない。 */
async function finishResult(destination, baseline) {
	const result = JSON.parse(
		await fs.readFile(path.join(destination, "mxc.json"), "utf8"),
	);
	result.source = await sourceVersions();
	await fs.copyFile(
		path.join(
			repoRoot,
			"apps/vscode-nerita/src/extension/runtime/MxcLauncher.ps1",
		),
		path.join(destination, "launcher-optimized.ps1"),
	);
	if (baseline) {
		result.source.baselineLauncherSha256 = createHash("sha256")
			.update(baseline)
			.digest("hex");
		await fs.writeFile(
			path.join(destination, "launcher-baseline.ps1"),
			baseline,
		);
	}
	await fs.writeFile(
		path.join(destination, "mxc.json"),
		JSON.stringify(result, null, 2),
	);
	console.log(`計測結果: ${path.relative(repoRoot, destination)}/mxc.json`);
	console.log(
		JSON.stringify(
			result.summary.map((item) => ({
				variant: item.variant,
				cache: item.persistentCache,
				phase: item.phase,
				count: item.count,
				requestMs: item.metrics.requestMs,
				afterApprovalMs: item.metrics.totalMs,
				cacheHits: item.cacheHits,
			})),
			null,
			2,
		),
	);
}

async function child() {
	const [temporary, extension, output, destination] = process.argv.slice(3);
	const { measure } = require(output);
	const baseline = await fs.readFile(
		path.join(temporary, "baseline.ps1"),
		"utf8",
	);
	const result = await measure(temporary, extension, baseline || undefined);
	await fs.writeFile(
		path.join(destination, "mxc.json"),
		JSON.stringify(result, null, 2),
	);
}

async function sourceVersions() {
	const files = [
		"apps/vscode-nerita/src/extension/runtime/MxcExecutor.ts",
		"apps/vscode-nerita/src/extension/runtime/MxcLauncher.ps1",
		"apps/vscode-nerita/src/extension/runtime/MxcPipeClient.cs",
		"config/package-mxc.cjs",
		"apps/vscode-nerita/src/extension/runtime/MxcLauncher.ts",
		"apps/vscode-nerita/src/extension/runtime/MxcPolicy.ts",
		"apps/vscode-nerita/src/extension/security/ApprovalGuard.ts",
		"apps/vscode-nerita/src/extension/backends/pi/PiPowerShellTool.ts",
		"tests/scratch/mxc-measurement.cjs",
		"tests/scratch/mxc-measurement.ts",
		"tests/scratch/mxc-measurement-support.ts",
	];
	const hashes = {};
	for (const file of files) {
		hashes[file] = createHash("sha256")
			.update(await fs.readFile(path.join(repoRoot, file)))
			.digest("hex");
	}
	const commit = spawnSync("git", ["rev-parse", "HEAD"], {
		cwd: repoRoot,
		windowsHide: true,
		encoding: "utf8",
	});
	if (commit.error || commit.status !== 0) {
		throw commit.error ?? new Error(commit.stderr);
	}
	return { head: commit.stdout.trim(), hashes };
}

const run = process.argv[2] === "--child" ? child : main;
run().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
