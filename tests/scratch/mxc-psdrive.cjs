// 一時 PSDrive の回避策を現行ポリシーで確認する。`node tests/scratch/mxc-psdrive.cjs` で実行する。
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { build } = require("esbuild");
const fs = require("node:fs/promises");

/** 実リポジトリには読取り操作だけを実行し、ポリシーの許可範囲は製品と揃える。 */
async function main() {
	const root = await fs.realpath(path.resolve(__dirname, "../.."));
	const extension = path.join(root, "apps/vscode-nerita");
	const output = path.join(root, "dist/mxc-psdrive.cjs");
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
	const body = await fs.readFile(
		path.join(__dirname, "mxc-psdrive.ps1"),
		"utf8",
	);
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) =>
			/^(systemroot|windir|systemdrive|comspec|path|pathext|temp|tmp|userprofile|localappdata|appdata|programfiles|programdata)$/i.test(
				key,
			),
		),
	);
	const result = await executeMxcCommand(
		sdk,
		{
			tool: "psdrive-probe",
			params: {},
			cwd: root,
			policy: {
				workspaceRoots: [root],
				writableRoots: [root],
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
				"-OutputFormat",
				"Text",
				"-EncodedCommand",
				Buffer.from(body, "utf16le").toString("base64"),
			],
			env,
			timeoutMs: 30000,
		},
		new AbortController().signal,
		undefined,
		(report) => console.log({ denialReport: report }),
	);
	console.log(result);
	process.exitCode = result.exitCode;
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
