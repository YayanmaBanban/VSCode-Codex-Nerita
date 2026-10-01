// 実 Extension Host の設定・拡張領域を毎回分離し、必要なら展開した VSIX だけを起動する。
const path = require("node:path");
const { copyFile } = require("node:fs/promises");
const { spawnSync } = require("node:child_process");
const { repoRoot, extensionRoot } = require("./workspace-paths.cjs");
const { withTestDirectory } = require("./test-process.cjs");

/** シェルの文字列連結を使わず、起動失敗・時間切れ・非ゼロ終了を伝える。 */
function run(executable, args, env) {
	const result = spawnSync(executable, args, {
		cwd: repoRoot,
		env,
		stdio: "inherit",
		windowsHide: true,
		timeout: 300000,
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(
			`Extension Host verification failed (${result.status ?? result.signal})`,
		);
	}
}

/** ユーザーの VS Code へインストールせず、配布物を一時領域へ展開して検証する。 */
async function main(directory) {
	const args = process.argv.slice(2).filter((arg) => arg !== "--");
	const vsix = args.includes("--vsix");
	const env = { ...process.env, NERITA_TEST_ROOT: directory };
	delete env.ELECTRON_RUN_AS_NODE;
	if (vsix) {
		if (process.platform !== "win32") {
			throw new Error(
				"VSIX の受入検証は Windows x64 で実行してください。",
			);
		}
		const zip = path.join(directory, "package.zip");
		const extracted = path.join(directory, "package");
		await copyFile(path.join(extensionRoot, "dist/nerita.vsix"), zip);
		run(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				"Expand-Archive -LiteralPath $env:NERITA_VSIX_ZIP -DestinationPath $env:NERITA_VSIX_TARGET",
			],
			{ ...env, NERITA_VSIX_ZIP: zip, NERITA_VSIX_TARGET: extracted },
		);
		env.NERITA_TEST_EXTENSION_PATH = path.join(extracted, "extension");
	}
	const cli = path.join(
		path.dirname(require.resolve("@vscode/test-cli")),
		"bin.mjs",
	);
	run(
		process.execPath,
		[
			cli,
			"--config",
			"tests/.vscode-test.mjs",
			...args.filter((arg) => arg !== "--vsix"),
		],
		env,
	);
	console.log(
		`[extension] PASS (${vsix ? "isolated VSIX" : "development build"})`,
	);
}

void withTestDirectory(main).catch((error) => {
	console.error("[extension] FAIL", error);
	process.exitCode = 1;
});
