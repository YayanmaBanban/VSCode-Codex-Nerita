// 製品経路の検証を、新しい SDK・プロセス・一時領域で実行する。
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { build } = require("esbuild");
const { bundlePi } = require("./package-pi.cjs");
const { repoRoot } = require("./workspace-paths.cjs");
const { regressions, regressionPlugin } = require("./product-regressions.cjs");
const externalAgentDir =
	process.env.NERITA_EXTERNAL_AGENT_DIR ??
	process.env.PI_CODING_AGENT_DIR ??
	path.join(os.homedir(), ".pi/agent");

/** 同じ入口を通常版と回帰注入版で実行する。 */
async function execute(root, files, environment, regression) {
	const output = path.join(root, regression ?? "baseline");
	await build({
		absWorkingDir: repoRoot,
		entryPoints: Object.fromEntries([
			...files.map((name) => [
				name.replace(/\.ts$/, ""),
				path.join("tests/product", name),
			]),
			["restorePi", "tests/support/restorePi.ts"],
		]),
		outdir: output,
		outExtension: { ".js": ".cjs" },
		bundle: true,
		platform: "node",
		format: "cjs",
		target: "node22",
		conditions: ["nerita-source"],
		alias: {
			vscode: path.join(repoRoot, "tests/support/vscode-boundary.cjs"),
		},
		plugins: regression ? [regressionPlugin(regression)] : [],
	});
	const result = spawnSync(
		process.execPath,
		[
			"--test",
			"--test-timeout=90000",
			`--test-reporter=${regression ? "tap" : "spec"}`,
			...files.map((name) =>
				path.join(output, name.replace(/\.ts$/, ".cjs")),
			),
		],
		{
			cwd: root,
			stdio: regression ? "pipe" : "inherit",
			encoding: "utf8",
			windowsHide: true,
			env: {
				...environment,
				NERITA_RESTORE_RUNNER: path.join(output, "restorePi.cjs"),
			},
			maxBuffer: 8 * 1024 * 1024,
		},
	);
	if (result.error) {
		throw result.error;
	}
	if (!regression) {
		return result.status === 0;
	}
	verifyRegression(result, regression);
	return true;
}

/** 読込み失敗や後片付け失敗を、製品回帰の検出に数えない。 */
function verifyRegression(result, regression) {
	if (
		result.status === 0 ||
		!result.stdout.includes("ERR_ASSERTION") ||
		result.stdout.includes("hookFailed") ||
		result.stdout.includes("MODULE_NOT_FOUND")
	) {
		console.error(result.stdout, result.stderr);
		throw new Error(
			`狙った回帰をアサーションで検出できません: ${regression}`,
		);
	}
	console.log(`回帰検出: ${regression}（通常版成功 → アサーション失敗）`);
}

/** 選んだ領域の回帰だけを、個別のプロセスで確認する。 */
async function verifyRegressions(root, files, environment) {
	for (const [name, regression] of Object.entries(regressions)) {
		const selected = files.filter((file) =>
			file.includes(regression.selection),
		);
		if (selected.length) {
			await execute(root, selected, environment, name);
		}
	}
}

/** 自分で作った一時領域だけを削除する。 */
async function removeRun(root) {
	if (
		path.dirname(root) !== os.tmpdir() ||
		!path.basename(root).startsWith("nerita-products-") ||
		(await fs.lstat(root)).isSymbolicLink()
	) {
		throw new Error("検証用の一時領域を確認できません。");
	}
	await fs.rm(root, { recursive: true, force: true });
}

/** ファイル名による選択を許可し、対象なしや準備失敗も終了コードへ反映する。 */
async function main() {
	const checkRegressions = process.argv.includes("--regressions");
	const external = process.argv.includes("--external");
	const selections = process.argv
		.slice(2)
		.filter((arg) => arg !== "--regressions" && arg !== "--external");
	const files = (await fs.readdir(path.join(repoRoot, "tests/product")))
		.filter((name) => name.endsWith(".test.ts"))
		.filter((name) => name.endsWith(".external.test.ts") === external)
		.filter(
			(name) =>
				selections.length === 0 ||
				selections.some((selection) => name.includes(selection)),
		);
	if (!files.length) {
		throw new Error("該当する製品検証がありません。");
	}
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "nerita-products-"));
	const started = Date.now();
	try {
		// SDK の祖先探索もここで止め、実ユーザーのスキルを検証へ混入させない。
		const initialized = spawnSync("git", ["init", "--quiet", root], {
			windowsHide: true,
			encoding: "utf8",
		});
		if (initialized.error || initialized.status !== 0) {
			throw initialized.error ?? new Error(initialized.stderr);
		}
		const home = path.join(root, "home");
		await fs.mkdir(home);
		const extensionPath =
			process.env.NERITA_DISTRIBUTION_TEST_EXTENSION ??
			path.join(root, "extension");
		if (!process.env.NERITA_DISTRIBUTION_TEST_EXTENSION) {
			await bundlePi(repoRoot, path.join(extensionPath, "dist/runtime"));
		}
		const environment = {
			...process.env,
			HOME: home,
			USERPROFILE: home,
			HOMEDRIVE: path.parse(home).root.slice(0, 2),
			HOMEPATH: home.slice(2),
			XDG_CONFIG_HOME: home,
			PI_CODING_AGENT_DIR: path.join(home, ".pi/agent"),
			CODEX_HOME: path.join(home, ".codex"),
			NERITA_TEST_EXTENSION: extensionPath,
			NERITA_TEST_ROOT: root,
			NERITA_EXTERNAL_AGENT_DIR: externalAgentDir,
		};
		if (!(await execute(root, files, environment))) {
			process.exitCode = 1;
			return;
		}
		if (checkRegressions) {
			await verifyRegressions(root, files, environment);
		}
	} finally {
		await removeRun(root);
		console.log(
			`製品検証: ${((Date.now() - started) / 1000).toFixed(1)} 秒（準備・回収を含む）`,
		);
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
