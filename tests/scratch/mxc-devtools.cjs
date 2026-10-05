// Git / pnpm の cwd 依存を、PowerShell / PSDrive を介さず MXC 上で比較する。
// 実行:
//   pnpm exec node tests/scratch/mxc-devtools.cjs
// pnpm 単体実行ファイルを明示する場合は環境変数 PNPM_EXE を使う。

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { build } = require("esbuild");
const { packageMxc } = require("../../config/package-mxc.cjs");

/**
 * 製品の MxcExecutor と同梱 MXC SDK を読み込む。
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
 * Host の秘密を持ち込まず、現在の製品実装が必要とする
 * OS / tool discovery 用環境だけ渡す。
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
 * MXC を一回起動する。
 *
 * workspace:
 *   実際の Nerita repository。
 *
 * cwd:
 *   プロセス起動時に MXC が設定する native cwd。
 *
 * workspace は read-only、
 * test cwd だけ read-write とする。
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

					// BaseContainer の path traversal 検証用。
					// Volume root grant は子孫へ連鎖しない。
					workspaceDrive,
				],

				writableRoots: [workspace, ...(cwd === workspace ? [] : [cwd])],

				shell: true,
				networkAccess: false,
				windowsSandbox: "elevated",
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
 * 一つのテストを実行して、失敗しても後続を続行する。
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
	 * workspace とは別の専用 cwd。
	 *
	 * SUBST や PSDrive は使わない。
	 * 通常の Host temp directory を MXC policy に
	 * 明示的に追加するだけ。
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
	 * 対照:
	 *
	 * MXC cwd = workspace
	 * git status
	 *
	 * 現在の症状:
	 * fatal: Unable to read current working directory:
	 * Permission denied
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
	 * 本命:
	 *
	 * MXC cwd = safe temp
	 * git -C <workspace> status
	 *
	 * これだけ成功するなら、
	 * workspace自体のread権限ではなく
	 * Git起動直後の getcwd() が原因と判断できる。
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
	 * --------------------------------------------------
	 * pnpm
	 * --------------------------------------------------
	 *
	 * pnpm.cmd は CreateProcess の直接実行対象ではないので、
	 * cmd.exe だけをシェルとして使用する。
	 *
	 * PowerShell / PSDrive は使用しない。
	 */
	const pnpmExe = process.env.PNPM_EXE ?? process.env.npm_execpath;
	if (!pnpmExe || path.extname(pnpmExe).toLowerCase() !== ".exe") {
		throw new Error(
			"PNPM_EXE に pnpm 単体実行ファイルを指定してください。",
		);
	}
	const pnpmCjs = path.join(root, "config/run-pnpm.cjs");
	/*
	 * 対照:
	 *
	 * cwd = workspace
	 * pnpm --version
	 *
	 * 現在は pnpm 内部の
	 * canonicalize("--dir" = ".")
	 * で os error 5 が出る想定。
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
	 * 本命:
	 *
	 * cwd = safe temp
	 * pnpm --dir <workspace> --version
	 *
	 * これが成功すれば、
	 * pnpmも "." のcanonicalizeだけが問題。
	 *
	 * これでも os error 5 なら、
	 * pnpmが明示workspace path自体をcanonicalize
	 * できていないことが分かる。
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
