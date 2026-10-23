/*
 * Nerita の `MxcExecutor`・`MxcPolicy` を通さず、@microsoft/mxc-sdk でファイルアクセスの制限を確認する。
 * 実行コマンドは `node tests/scratch/mxc-direct-fs-matrix.mjs`。
 *
 * 確認する内容は次のとおり。
 * - 読み書きを許可したパスでは、読み取り・書き込みができること。
 * - 読み取りだけを許可したパスでは、書き込みが拒否されること。
 * - 個別に許可していない比較用パスでは、読み取り・書き込みが拒否されること。
 * - ワークスペースがあるドライブのルートに読み取りを許可した場合だけ、比較用パスも読み取れるか。
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function quoteWindowsArgument(value) {
	return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

async function loadSdk(repoRoot) {
	const sdkPath = path.join(
		repoRoot,
		"apps",
		"vscode-nerita",
		"node_modules",
		"@microsoft",
		"mxc-sdk",
		"dist",
		"index.js",
	);

	const sdk = await import(pathToFileURL(sdkPath).href);

	for (const name of [
		"getPlatformSupport",
		"createConfigFromPolicy",
		"spawnSandboxFromConfig",
	]) {
		if (typeof sdk[name] !== "function") {
			throw new Error(
				`MXC SDK に ${name}() がありません。exports=${Object.keys(sdk).join(", ")}`,
			);
		}
	}

	return sdk;
}

function commandEnvironment(nodeDirectory, sandboxHome) {
	const systemRoot = process.env.SystemRoot;

	if (!systemRoot) {
		throw new Error("環境変数 `SystemRoot` が設定されていません。");
	}

	return [
		`SYSTEMROOT=${systemRoot}`,

		// Windows ProcessContainer の起動に必須。
		// Host の LOCALAPPDATA は渡さず、テスト専用領域を使用する。
		`LOCALAPPDATA=${sandboxHome}`,

		`WINDIR=${process.env.WINDIR ?? systemRoot}`,
		`COMSPEC=${
			process.env.ComSpec ?? path.join(systemRoot, "System32", "cmd.exe")
		}`,
		`PATHEXT=${process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD"}`,

		`PATH=${[
			nodeDirectory,
			path.join(systemRoot, "System32"),
			systemRoot,
		].join(path.delimiter)}`,

		// 起動の必須条件ではないが、ホストのユーザープロファイルを参照させない。
		`USERPROFILE=${sandboxHome}`,
		`APPDATA=${sandboxHome}`,
		`HOME=${sandboxHome}`,
		`TEMP=${sandboxHome}`,
		`TMP=${sandboxHome}`,
	];
}

function createProbeScript({ rw, ro, control }) {
	return `
const fs = require("node:fs");

function probe(name, action) {
	try {
		action();
		console.log(name + "=PASS");
	} catch (error) {
		console.log(
			name +
			"=FAIL" +
			" code=" +
			(error && error.code ? error.code : "unknown")
		);
	}
}

probe("RW_WRITE", () => {
	fs.writeFileSync(${JSON.stringify(
		path.join(rw, "rw-marker.txt"),
	)}, "sandbox-write");
});

probe("RW_READ", () => {
	fs.readFileSync(${JSON.stringify(path.join(rw, "rw-marker.txt"))}, "utf8");
});

probe("RO_READ", () => {
	fs.readFileSync(${JSON.stringify(path.join(ro, "readme.txt"))}, "utf8");
});

probe("RO_WRITE", () => {
	fs.writeFileSync(${JSON.stringify(
		path.join(ro, "write-attempt.txt"),
	)}, "should-not-write");
});

probe("CONTROL_READ", () => {
	fs.readFileSync(${JSON.stringify(path.join(control, "readme.txt"))}, "utf8");
});

probe("CONTROL_WRITE", () => {
	fs.writeFileSync(${JSON.stringify(
		path.join(control, "write-attempt.txt"),
	)}, "should-not-write");
});
`.trim();
}

async function spawnAndCollect(sdk, config, cwd) {
	const child = sdk.spawnSandboxFromConfig(
		config,
		{
			usePty: false,
		},
		cwd,
	);

	let stdout = "";
	let stderr = "";

	child.stdout?.setEncoding("utf8");
	child.stderr?.setEncoding("utf8");

	child.stdout?.on("data", (chunk) => {
		stdout += chunk;
		process.stdout.write(`[stdout] ${chunk}`);
	});

	child.stderr?.on("data", (chunk) => {
		stderr += chunk;
		process.stderr.write(`[stderr] ${chunk}`);
	});

	const exitCode = await new Promise((resolve, reject) => {
		child.once("error", reject);

		child.once("close", (code) => {
			if (code === null) {
				reject(new Error("MXC プロセスの終了コードを取得できません。"));
				return;
			}

			resolve(code);
		});
	});

	return {
		exitCode,
		stdout,
		stderr,
	};
}

function parseMatrix(stdout) {
	const matrix = {};

	for (const line of stdout.split(/\r?\n/u)) {
		const match = line.match(
			/^(RW_WRITE|RW_READ|RO_READ|RO_WRITE|CONTROL_READ|CONTROL_WRITE)=(PASS|FAIL)/u,
		);

		if (match) {
			matrix[match[1]] = match[2];
		}
	}

	return matrix;
}

function printMatrix(name, result) {
	console.log("");
	console.log("=".repeat(72));
	console.log(name);
	console.log("=".repeat(72));

	const matrix = parseMatrix(result.stdout);

	for (const key of [
		"RW_WRITE",
		"RW_READ",
		"RO_READ",
		"RO_WRITE",
		"CONTROL_READ",
		"CONTROL_WRITE",
	]) {
		console.log(key.padEnd(16), matrix[key] ?? "<missing>");
	}

	console.log("exitCode".padEnd(16), result.exitCode);

	return matrix;
}

function createCaseConfig({
	sdk,
	rw,
	ro,
	nodeExe,
	withVolumeRoot,
	leastPrivilege = false,
}) {
	const nodeDirectory = path.dirname(nodeExe);
	const volumeRoot = path.parse(rw).root;

	const readonlyPaths = [nodeDirectory, ro];

	if (withVolumeRoot) {
		readonlyPaths.push(volumeRoot);
	}

	/*
	 * ワークスペースに相当する `rw` は読み書きを許可し、検証条件に応じて同じドライブのルートの読み取りも許可する。
	 * 比較用の `control` は個別には許可リストへ追加しない。
	 */
	const config = sdk.createConfigFromPolicy(
		{
			version: "0.9.0-alpha",

			filesystem: {
				readwritePaths: [rw],
				readonlyPaths,
			},

			network: {
				egress: {
					default: "deny",
				},
				ingress: {
					default: "deny",
					hostLoopback: "deny",
				},
			},

			ui: {
				allowWindows: true,
				clipboard: "none",
				allowInputInjection: false,
			},

			timeoutMs: 30_000,
		},
		"process",
	);

	/*
	 * Nerita と同じく Windows では ProcessContainer を明示する。
	 */
	config.containment = "processcontainer";

	if (leastPrivilege) {
		configureLeastPrivilege(config);
	}

	return config;
}

function configureLeastPrivilege(config) {
	config.processContainer = {
		...(config.processContainer ?? {}),
		leastPrivilege: true,
	};

	/*
	 * BaseContainer の代わりに AppContainer を使う条件として、`leastPrivilege` を指定する。
	 *
	 * DACL を使う方式（T3）への切り替えに備え、ポリシー対象パスのホスト側 DACL の一時変更も明示的に許可する。
	 */
	config.fallback = {
		...(config.fallback ?? {}),
		allowDaclMutation: true,
	};

	console.log(
		JSON.stringify(
			{
				containment: config.containment,
				leastPrivilege:
					config.processContainer?.leastPrivilege ?? false,
				fallback: config.fallback,
				cwd: config.process.cwd,
				filesystem: config.filesystem,
			},
			null,
			2,
		),
	);
}

function createProbeCommand({ rw, ro, control, nodeExe, useCmd }) {
	if (useCmd) {
		const cmdExe = path.join(process.env.SystemRoot, "System32", "cmd.exe");

		const clauses = [
			`(echo sandbox-write > "${path.join(rw, "rw-marker.txt")}") && echo RW_WRITE=PASS || echo RW_WRITE=FAIL`,
			`(type "${path.join(rw, "rw-marker.txt")}") && echo RW_READ=PASS || echo RW_READ=FAIL`,

			`(type "${path.join(ro, "readme.txt")}") && echo RO_READ=PASS || echo RO_READ=FAIL`,
			`(echo denied > "${path.join(ro, "write-attempt.txt")}") && echo RO_WRITE=PASS || echo RO_WRITE=FAIL`,

			`(type "${path.join(control, "readme.txt")}") && echo CONTROL_READ=PASS || echo CONTROL_READ=FAIL`,
			`(echo denied > "${path.join(control, "write-attempt.txt")}") && echo CONTROL_WRITE=PASS || echo CONTROL_WRITE=FAIL`,
		];

		return [cmdExe, "/D", "/S", "/C", clauses.join(" & ")]
			.map(quoteWindowsArgument)
			.join(" ");
	}

	const probeScript = createProbeScript({ rw, ro, control });
	return [nodeExe, "-e", probeScript].map(quoteWindowsArgument).join(" ");
}

async function runCase(options) {
	const { sdk, name, rw, nodeExe, leastPrivilege = false } = options;
	const config = createCaseConfig(options);

	config.process = {
		...config.process,
		commandLine: createProbeCommand(options),
		cwd: rw,
		env: commandEnvironment(path.dirname(nodeExe), rw),
	};

	console.log("");
	console.log("=".repeat(72));
	console.log(name);
	console.log("=".repeat(72));

	console.log(
		JSON.stringify(
			{
				containment: config.containment,
				cwd: config.process.cwd,
				filesystem: config.filesystem,
			},
			null,
			2,
		),
	);

	if (leastPrivilege) {
		const probeConfigPath = path.join(
			os.tmpdir(),
			"nerita-mxc-appcontainer-probe.json",
		);

		await fs.writeFile(
			probeConfigPath,
			JSON.stringify(config, null, 2),
			"utf8",
		);

		console.log("C probe config:", probeConfigPath);
	}

	const result = await spawnAndCollect(sdk, config, rw);

	const matrix = printMatrix(`${name} RESULT`, result);

	return {
		...result,
		matrix,
	};
}

async function runWithoutVolumeRoot({ sdk, rw, ro, control, nodeExe }) {
	/*
	 * 条件 A はドライブのルートに読み取りを許可せず、Issue #1109 の比較対象にする。
	 * このホスト環境では、作業フォルダのパスの解決に失敗する可能性がある。
	 */
	let withoutRoot;

	try {
		withoutRoot = await runCase({
			sdk,
			name: "WITHOUT volume-root RO",
			rw,
			ro,
			control,
			nodeExe,
			withVolumeRoot: false,
		});
	} catch (error) {
		console.log("");
		console.log("WITHOUT volume-root RO failed before matrix:");
		console.log(error instanceof Error ? error.stack : error);
	}

	return withoutRoot;
}

function compareMatrix(matrix, expected) {
	let mismatch = false;
	for (const [key, expectedValue] of Object.entries(expected)) {
		const actual = matrix[key] ?? "<missing>";

		const ok = actual === expectedValue;

		console.log(
			key.padEnd(16),
			`expected=${expectedValue}`,
			`actual=${actual}`,
			ok ? "OK" : "MISMATCH",
		);

		if (!ok) {
			mismatch = true;
		}
	}

	return mismatch;
}

function reportOutsideRead(withRoot) {
	if (withRoot.matrix.CONTROL_READ === "PASS") {
		console.error("MXC_DIRECT_OUTSIDE_READ_VISIBLE");

		console.error(
			`
Nerita の実行処理やポリシー変換を通さず、
@microsoft/mxc-sdk を直接使用した場合も、
個別には読み取りを許可していない比較用パスを読み取れました。

Nerita のリソース権限追加処理を経由せずに再現しています。
SDK に渡した設定と、MXC・ProcessContainer・Windows による
ファイルアクセス制御を確認するための再現結果です。
`.trim(),
		);
	}
}

async function runMatrixCases({ sdk, rw, ro, control, nodeExe }) {
	const withoutRoot = await runWithoutVolumeRoot({
		sdk,
		rw,
		ro,
		control,
		nodeExe,
	});

	/*
	 * 条件 B はドライブのルートに読み取りを許可し、Nerita のパス解決用の互換設定に近い条件を再現する。
	 */
	const withRoot = await runCase({
		sdk,
		name: "WITH volume-root RO",
		rw,
		ro,
		control,
		nodeExe,
		withVolumeRoot: true,
	});

	console.log("");
	console.log("=".repeat(72));
	console.log("Expected WITH volume-root RO");
	console.log("=".repeat(72));

	const expected = {
		RW_WRITE: "PASS",
		RW_READ: "PASS",
		RO_READ: "PASS",
		RO_WRITE: "FAIL",
		CONTROL_READ: "FAIL",
		CONTROL_WRITE: "FAIL",
	};

	let mismatch = compareMatrix(withRoot.matrix, expected);

	console.log("");
	console.log("=".repeat(72));
	console.log(
		"C: AppContainer fallback / leastPrivilege / NO volume-root RO",
	);
	console.log("=".repeat(72));

	const appContainer = await runCase({
		sdk,
		name: "C: AppContainer fallback / leastPrivilege / NO volume-root RO",
		rw,
		ro,
		control,
		nodeExe,

		// 条件 C ではドライブのルートに読み取りを許可しない。
		withVolumeRoot: false,

		// BaseContainer の代わりに AppContainer での実行を要求する。
		leastPrivilege: true,

		// Node.js と Winsock の互換性の影響を避け、ファイルアクセスの制限を検証する。
		useCmd: true,
	});

	if (compareMatrix(appContainer.matrix, expected)) {
		mismatch = true;
	}

	console.log("");

	reportOutsideRead(withRoot);

	if (mismatch) {
		process.exitCode = 1;
		return;
	}

	console.log("MXC direct filesystem matrix PASSED.");

	if (withoutRoot) {
		console.log("WITHOUT volume-root RO exit:", withoutRoot.exitCode);
	}
}

async function main() {
	if (process.platform !== "win32") {
		throw new Error("このテストは Windows MXC 専用です。");
	}

	if (Number(process.versions.node.split(".")[0]) < 24) {
		throw new Error(`Node.js 24以上が必要です。現在: ${process.version}`);
	}

	const repoRoot = await fs.realpath(
		path.resolve(
			path.dirname(new URL(import.meta.url).pathname.slice(1)),
			"..",
			"..",
		),
	);

	const sdk = await loadSdk(repoRoot);

	console.log("MXC platform support:");
	console.log(JSON.stringify(sdk.getPlatformSupport(), null, 2));

	const nodeExe = await fs.realpath(process.execPath);

	console.log("Node executable:", nodeExe);

	const root = await fs.mkdtemp(
		path.join(os.tmpdir(), "nerita-mxc-sdk-direct-"),
	);

	const rw = path.join(root, "rw");
	const ro = path.join(root, "ro");
	const control = path.join(root, "control");

	await Promise.all([fs.mkdir(rw), fs.mkdir(ro), fs.mkdir(control)]);

	await fs.writeFile(path.join(ro, "readme.txt"), "ro-content");

	await fs.writeFile(path.join(control, "readme.txt"), "control-content");

	console.log("");
	console.log("Host fixture:");
	console.log({
		root,
		volumeRoot: path.parse(root).root,
		rw,
		ro,
		control,
	});

	try {
		await runMatrixCases({ sdk, rw, ro, control, nodeExe });
	} finally {
		if (process.env.MXC_KEEP_ARTIFACTS === "1") {
			console.log("");
			console.log("MXC fixture preserved:");
			console.log(root);
		} else {
			await fs.rm(root, {
				recursive: true,
				force: true,
			});
		}
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
