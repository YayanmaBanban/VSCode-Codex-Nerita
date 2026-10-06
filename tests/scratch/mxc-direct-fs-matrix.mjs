// Nerita の MxcExecutor / MxcPolicy を一切通さず、
// @microsoft/mxc-sdk を直接使って filesystem isolation を確認する。
//
// 実行:
//   node tests/scratch/mxc-sdk-direct-fs-matrix.mjs
//
// 見たいこと:
//   - 明示 RW path は read/write できる
//   - 明示 RO path は read のみできる
//   - policy に一切含まれない control path は read/write とも拒否される
//   - workspace volume root を RO に加えた時だけ control read が通ってしまうか

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
		throw new Error("SystemRoot がありません。");
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

		// 必須ではないが、Host profileを参照させない。
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
				reject(new Error("MXC process の終了コードを取得できません。"));
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

async function runCase({
	sdk,
	name,
	rw,
	ro,
	control,
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
	 * Nerita と同じ方針:
	 *
	 * filesystem:
	 *   workspace       RW
	 *   volume root     RO compatibility grant
	 *
	 * ただし control は明示的には一切入れない。
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
		config.processContainer = {
			...(config.processContainer ?? {}),
			leastPrivilege: true,
		};

		/*
		 * leastPrivilege は BaseContainer/PSEC では表現できないため、
		 * MXC は AppContainer fallback tier を選択する。
		 *
		 * T3 AppContainer+DACL に落ちた場合、policy path のHost DACLを
		 * 一時変更する必要があるため明示的に許可する。
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

	const probeScript = createProbeScript({
		rw,
		ro,
		control,
	});

	config.process = {
		...config.process,

		commandLine: [nodeExe, "-e", probeScript]
			.map(quoteWindowsArgument)
			.join(" "),

		cwd: rw,

		env: commandEnvironment(nodeDirectory, rw),
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

	const result = await spawnAndCollect(sdk, config, rw);

	const matrix = printMatrix(`${name} RESULT`, result);

	return {
		...result,
		matrix,
	};
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
		/*
		 * Case A:
		 *
		 * Issue #1109 の対照。
		 * このHostではcwd解決に失敗する可能性がある。
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

		/*
		 * Case B:
		 *
		 * Nerita の現在の workspace volume-root compatibility
		 * grant に近い条件。
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

		let mismatch = false;

		for (const [key, expectedValue] of Object.entries(expected)) {
			const actual = withRoot.matrix[key] ?? "<missing>";

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

			// 重要: CではC:\をROに入れない
			withVolumeRoot: false,

			// BaseContainerを使わせない
			leastPrivilege: true,
		});

		for (const [key, expectedValue] of Object.entries(expected)) {
			const actual = appContainer.matrix[key] ?? "<missing>";

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

		console.log("");

		if (withRoot.matrix.CONTROL_READ === "PASS") {
			console.error("MXC_DIRECT_OUTSIDE_READ_VISIBLE");

			console.error(
				`
Nerita の MxcExecutor / MxcPolicy を通していない
@microsoft/mxc-sdk 直接実行でも、
policy に含めていない control path を読み取れました。

この場合、ResourceGrant の問題ではありません。
MXC / ProcessContainer / Windows filesystem enforcement
の再現として扱えます。
`.trim(),
			);
		}

		if (mismatch) {
			process.exitCode = 1;
			return;
		}

		console.log("MXC direct filesystem matrix PASSED.");

		if (withoutRoot) {
			console.log("WITHOUT volume-root RO exit:", withoutRoot.exitCode);
		}
	} finally {
		await fs.rm(root, {
			recursive: true,
			force: true,
		});
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
