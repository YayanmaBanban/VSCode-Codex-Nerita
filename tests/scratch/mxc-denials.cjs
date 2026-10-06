// SDK の拒否記録を権限を緩和せず検証する。`node tests/scratch/mxc-denials.cjs` で実行する。
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { build } = require("esbuild");
const assert = require("node:assert/strict");

/** レポートは Sandbox に公開しない一時領域で受け取り、検証後に削除する。 */
async function main() {
	const root = await fs.realpath(path.resolve(__dirname, "../.."));
	const { createMxcConfig, sdk } = await loadRuntime(root);
	await capture(root, createMxcConfig, sdk);
}

/** 同梱 SDK と今回の製品コードを組み合わせる。 */
async function loadRuntime(root) {
	const extension = path.join(root, "apps/vscode-nerita");
	const output = path.join(root, "dist/mxc-denials.cjs");
	await build({
		entryPoints: [
			path.join(extension, "src/extension/runtime/MxcPolicy.ts"),
		],
		outfile: output,
		bundle: true,
		platform: "node",
		format: "cjs",
	});
	const { createMxcConfig } = require(output);
	const sdk = await import(
		pathToFileURL(
			path.join(
				extension,
				"dist/runtime/node_modules/@microsoft/mxc-sdk/dist/index.js",
			),
		).href
	);
	return { createMxcConfig, sdk };
}

/** 拒否対象は検証用のファイルだけに限定する。 */
async function capture(root, createMxcConfig, sdk) {
	const temporary = await fs.mkdtemp(
		path.join(require("node:os").tmpdir(), "nerita-denials-"),
	);
	try {
		const sandboxTemp = path.join(temporary, "sandbox");
		await fs.mkdir(sandboxTemp);
		const report = path.join(temporary, "denials.json");
		const config = createMxcConfig(
			sdk,
			{
				tool: "denial-probe",
				params: {},
				cwd: root,
				policy: {
					workspaceRoots: [root],
					writableRoots: [],
					shell: true,
					networkAccess: false,
					windowsSandbox: "elevated",
				},
				command: [
					path.join(
						process.env.SystemRoot,
						"System32/WindowsPowerShell/v1.0/powershell.exe",
					),
					"-NoProfile",
					"-NonInteractive",
					"-Command",
					"try { [IO.File]::ReadAllText($env:NERITA_DENIED_FILE); exit 42 } catch [UnauthorizedAccessException] { [Console]::WriteLine('NERITA_ACCESS_DENIED'); exit 1 }",
				],
				env: Object.fromEntries(
					Object.entries(process.env).filter(([key]) =>
						/^(systemroot|windir|systemdrive|comspec|path|pathext|userprofile|localappdata|appdata|programfiles|programdata)$/i.test(
							key,
						),
					),
				),
				timeoutMs: 15000,
			},
			sandboxTemp,
		);
		const deniedFile = path.join(temporary, "outside.txt");
		await fs.writeFile(deniedFile, "test-only-denied-content");
		config.process.env.push(`NERITA_DENIED_FILE=${deniedFile}`);
		config.process.env.push(`LOCALAPPDATA=${sandboxTemp}`);
		config.processContainer = {
			...config.processContainer,
			captureDenials: {
				mode: "block",
				outputPath: report,
				retainEtl: false,
			},
		};
		const child = sdk.spawnSandboxFromConfig(
			config,
			{ usePty: false },
			root,
		);
		child.stdout.pipe(process.stdout);
		child.stderr.pipe(process.stderr);
		child.stdin.end();
		await new Promise((resolve, reject) => {
			child.once("close", (code) => {
				if (code === 1) {
					resolve();
				} else {
					reject(
						new Error(`拒否対象の読取り結果が想定外です: ${code}`),
					);
				}
			});
			child.once("error", reject);
		});
		await verifyDenials(temporary, deniedFile);
	} finally {
		await fs.rm(temporary, { recursive: true, force: true });
	}
}

/** 拒否が実際に起きてもレポートが空なら成功扱いにしない。 */
async function verifyDenials(temporary, deniedFile) {
	const files = (await fs.readdir(temporary)).filter((file) =>
		/^denials\.[\w-]+\.json$/.test(file),
	);
	assert.equal(files.length, 1, "拒否レポートが必要です");
	const report = JSON.parse(
		await fs.readFile(path.join(temporary, files[0]), "utf8"),
	);
	console.log(report);
	assert.ok(
		report.denials.some(
			(denial) =>
				denial.resource.toLowerCase() === deniedFile.toLowerCase(),
		),
		"実際に拒否したファイルが captureDenials に記録されていません",
	);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
