// Git / pnpm の cwd 依存を、PowerShell / PSDrive を介さず MXC 上で比較する。
// `pnpm exec node tests/scratch/mxc-devtools.cjs` で実行する。
// pnpm 単体実行ファイルを明示する場合は環境変数 `PNPM_EXE` を使う。

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { build } = require("esbuild");
const { packageMxc } = require("../../config/package-mxc.cjs");

/**
 * 製品の `MxcExecutor` と同梱 MXC SDK を読み込む。
 */
async function loadRuntime(root) {
	const extension = path.join(root, "apps/vscode-nerita");
	const output = path.join(root, "dist/mxc-devtools.cjs");

	await packageMxc(path.join(extension, "dist/runtime"));

	await build({
		entryPoints: [
			path.join(extension, "src/extension/runtime/MxcExecutor.ts"),
		],
		outfile: output,
		bundle: true,
		platform: "node",
		format: "cjs",
	});

	const { executeMxcCommand } = require(output);

	const sdk = await import(
		pathToFileURL(
			path.join(
				extension,
				"dist/runtime/node_modules/@microsoft/mxc-sdk/dist/index.js",
			),
		).href
	);

	return {
		executeMxcCommand,
		sdk,
	};
}

/**
 * Host の秘密を持ち込まず、OS の起動とツールの検出に必要な環境変数だけを渡す。
 */
function commandEnvironment() {
	const allowed =
		/^(?:systemroot|windir|systemdrive|comspec|path|pathext|temp|tmp|programfiles|programfiles\\(x86\\)|programw6432|programdata|userprofile|homedrive|homepath|localappdata|appdata|os|processor_architecture|number_of_processors)$/i;

	return Object.fromEntries(
		Object.entries(process.env).filter(
			([key, value]) =>
				allowed.test(key) &&
				typeof value === "string" &&
				value.length > 0,
		),
	);
}

/**
 * MXC を1回起動する。
 * `workspace` は Nerita のリポジトリ、`cwd` は MXC がプロセス起動時に設定する作業ディレクトリを指定する。
 * この比較試験では、リポジトリとテスト用の作業ディレクトリに書込みを許可する。
 */
async function runMxc({ executeMxcCommand, sdk, workspace, cwd, command }) {
	const report = [];

	const workspaceDrive = path.parse(workspace).root;

	const result = await executeMxcCommand(
		sdk,
		{
			tool: "mxc-devtools-probe",
			params: {},
			cwd,

			policy: {
				workspaceRoots: [
					workspace,
					cwd,

					// BaseContainer でドライブ直下を経由するパス解決を検証する。
					// ドライブ直下の許可は配下のディレクトリやファイルへ継承されない。
					workspaceDrive,
				],

				writableRoots: [workspace, ...(cwd === workspace ? [] : [cwd])],

				shell: true,
				networkAccess: false,
			},

			command,
			env: commandEnvironment(),
			timeoutMs: 30_000,
		},
		new AbortController().signal,
		(stream, chunk) => {
			process.stdout.write(`[${stream}] ${chunk}`);
		},
		(denials) => {
			report.push(denials);
		},
	);

	return {
		...result,
		denials: report,
	};
}

/**
 * 1つのテストを実行して、失敗しても後続を続行する。
 */
async function probe(name, action) {
	console.log("");
	console.log("=".repeat(72));
	console.log(name);
	console.log("=".repeat(72));

	try {
		const result = await action();

		console.log("");
		console.log(
			JSON.stringify(
				{
					name,
					exitCode: result.exitCode,
					stdout: result.stdout,
					stderr: result.stderr,
					denials: result.denials,
				},
				null,
				2,
			),
		);

		return {
			name,
			passed: result.exitCode === 0,
			result,
		};
	} catch (error) {
		console.error(error);

		return {
			name,
			passed: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** 一時 cwd を用意し、比較結果を出力してから後片付けする。 */
async function main() {
	if (process.platform !== "win32") {
		throw new Error("このテストは Windows MXC 専用です。");
	}

	const root = await fs.realpath(path.resolve(__dirname, "../.."));

	const { executeMxcCommand, sdk } = await loadRuntime(root);

	console.log("MXC support:");
	console.log(sdk.getPlatformSupport());

	/*
	 * ワークスペースとは別に専用の作業ディレクトリを作る。
	 * SUBST や PSDrive は使わず、Host の通常の一時ディレクトリを MXC の許可範囲へ明示的に追加する。
	 */
	const tempRoot = await fs.mkdtemp(
		path.join(os.tmpdir(), "nerita-mxc-devtools-"),
	);

	const safeCwd = path.join(tempRoot, "cwd");

	await fs.mkdir(safeCwd);

	const context = {
		executeMxcCommand,
		sdk,
		workspace: root,
	};

	const results = [];

	try {
		results.push(...(await probeGit(context, safeCwd)));
		results.push(...(await probePnpm(context, safeCwd)));
		results.push(...(await probeNode(context, safeCwd)));

		console.log("");
		console.log("# Summary");
		console.log(
			JSON.stringify(
				results.map((result) => ({
					name: result.name,
					passed: result.passed,
					exitCode: result.result?.exitCode,
					error: result.error,
				})),
				null,
				2,
			),
		);

		// A/B 結果の比較が目的なので、各 probe の成功を終了条件にしない。
	} finally {
		await fs.rm(tempRoot, {
			recursive: true,
			force: true,
		});
	}
}

/** Git の起動時 cwd と明示的な作業ディレクトリの差を比較する。 */
async function probeGit(context, safeCwd) {
	const root = context.workspace;
	const results = [];
	/*
	 * --------------------------------------------------
	 * Git
	 * --------------------------------------------------
	 */

	/*
	 * 対照として、ワークスペースを作業ディレクトリにして `git status` を実行する。
	 * 調査対象は、現在の作業ディレクトリを読み取れず `Permission denied` となる症状。
	 */
	results.push(
		await probe("Git / workspace cwd", () =>
			runMxc({
				...context,
				cwd: root,
				command: [
					"git.exe",
					"--no-optional-locks",
					"status",
					"--short",
				],
			}),
		),
	);

	/*
	 * 一時ディレクトリを作業ディレクトリにして、`git -C <workspace> status` を実行する。
	 * こちらだけ成功する場合は、ワークスペースの読取り権限よりも、Git 起動直後の `getcwd()` が原因の候補となる。
	 */
	results.push(
		await probe("Git / temp cwd + -C workspace", () =>
			runMxc({
				...context,
				cwd: safeCwd,
				command: [
					"git.exe",
					"--no-optional-locks",
					"-C",
					root,
					"status",
					"--short",
				],
			}),
		),
	);

	return results;
}

/** pnpm の起動時 cwd と --dir 指定の差を比較する。 */
async function probePnpm(context, safeCwd) {
	const root = context.workspace;
	const results = [];
	/*
	 * pnpm 単体実行ファイルと、Node.js 経由の JavaScript エントリーポイントを比較する。
	 * `pnpm.cmd` やシェルは起動せず、PSDrive も使用しない。
	 */
	const pnpmExe = process.env.PNPM_EXE ?? process.env.npm_execpath;
	if (!pnpmExe || path.extname(pnpmExe).toLowerCase() !== ".exe") {
		throw new Error(
			"PNPM_EXE に pnpm 単体実行ファイルを指定してください。",
		);
	}
	const pnpmCjs = path.join(root, "config/run-pnpm.cjs");
	/*
	 * 対照として、ワークスペースを作業ディレクトリにして `pnpm --version` を実行する。
	 * pnpm 内部で `--dir` の既定値 `.` を正規化するときに、`os error 5` が出ると想定している。
	 */
	results.push(
		await probe("pnpm / workspace cwd", () =>
			runMxc({
				...context,
				cwd: root,
				command: [pnpmExe, "--version"],
			}),
		),
	);

	/*
	 * 一時ディレクトリを作業ディレクトリにして、`pnpm --dir <workspace> --version` を実行する。
	 * こちらだけ成功する場合は、`.` の正規化が原因の候補となる。
	 * こちらでも `os error 5` が出る場合は、明示したワークスペースのパスを正規化できているかを調べる。
	 */
	results.push(
		await probe("pnpm / temp cwd + --dir workspace", () =>
			runMxc({
				...context,
				cwd: safeCwd,
				command: [pnpmExe, "--dir", root, "--version"],
			}),
		),
	);

	const nodeExe = await fs.realpath(process.execPath);

	results.push(
		await probe("pnpm cjs / temp cwd + --dir workspace", () =>
			runMxc({
				...context,
				cwd: safeCwd,
				command: [nodeExe, pnpmCjs, "--dir", root, "--version"],
			}),
		),
	);

	return results;
}

/** Node による直接読み込みと chdir を比較する。 */
async function probeNode(context, safeCwd) {
	const root = context.workspace;
	const nodeExe = await fs.realpath(process.execPath);
	const results = [];
	results.push(
		await probe("Node / temp cwd + absolute workspace read", () =>
			runMxc({
				...context,
				cwd: safeCwd,
				command: [
					nodeExe,
					"-e",
					[
						'const fs = require("node:fs");',
						'const path = require("node:path");',
						"const root = process.argv[1];",
						'console.log("cwd=" + process.cwd());',
						'const file = path.join(root, "package.json");',
						'console.log("stat=" + fs.statSync(file).isFile());',
						'console.log("read=" + fs.readFileSync(file, "utf8").slice(0, 40));',
					].join(" "),
					root,
				],
			}),
		),
	);

	results.push(
		await probe("Node / temp cwd + chdir workspace", () =>
			runMxc({
				...context,
				cwd: safeCwd,
				command: [
					nodeExe,
					"-e",
					[
						'const fs = require("node:fs");',
						"const root = process.argv[1];",
						'console.log("before=" + process.cwd());',
						"process.chdir(root);",
						'console.log("after=" + process.cwd());',
					].join(" "),
					root,
				],
			}),
		),
	);

	return results;
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
