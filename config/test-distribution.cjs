// 今回生成した VSIX を一時領域へ展開し、同梱 SDK と実 Extension Host を検証する。
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { runTests } = require("@vscode/test-electron");
const { build } = require("esbuild");
const { runPnpm } = require("./run-pnpm.cjs");
const { repoRoot, extensionRoot } = require("./workspace-paths.cjs");

/** 外部コマンドの失敗を受入失敗へ反映する。 */
function run(executable, args, env) {
	const result = spawnSync(executable, args, {
		env,
		stdio: "inherit",
		windowsHide: true,
	});
	if (result.error || result.status !== 0) {
		throw new Error("配布検証のコマンドが失敗しました。", {
			cause: result.error,
		});
	}
}

/** 新規プロファイルと展開物だけを使用し、利用者の拡張機能へインストールしない。 */
async function main() {
	if (process.platform !== "win32" || process.arch !== "x64") {
		throw new Error("Windows x64 で実行してください。");
	}
	runPnpm(["run", "package:vsix"]);
	const root = await fs.mkdtemp(
		path.join(os.tmpdir(), "nerita-distribution-"),
	);
	try {
		const archive = path.join(root, "extension.zip");
		const extracted = path.join(root, "package");
		await fs.copyFile(
			path.join(extensionRoot, "dist/nerita.vsix"),
			archive,
		);
		run(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				"Expand-Archive -LiteralPath $env:NERITA_TEST_ARCHIVE -DestinationPath $env:NERITA_TEST_EXTRACTED",
			],
			{
				...process.env,
				NERITA_TEST_ARCHIVE: archive,
				NERITA_TEST_EXTRACTED: extracted,
			},
		);
		const extension = path.join(extracted, "extension");
		if (process.argv.includes("--sandbox")) {
			await verifySandbox(extension, root);
			return;
		}
		run(
			process.execPath,
			[path.join(repoRoot, "config/test-products.cjs")],
			{
				...process.env,
				NERITA_DISTRIBUTION_TEST_EXTENSION: extension,
			},
		);
		const workspace = path.join(root, "workspace");
		await fs.mkdir(workspace);
		const uiEnv = process.argv.includes("--ui")
			? await prepareWebview(root)
			: {};
		const user = path.join(root, "profile/User");
		await fs.mkdir(user, { recursive: true });
		await fs.writeFile(
			path.join(user, "settings.json"),
			JSON.stringify({
				"nerita.backend": "pi",
				"window.dialogStyle": "custom",
			}),
		);
		if (process.argv.includes("--ui")) {
			await require("./test-webview.cjs").launch(extension, root, uiEnv);
			return;
		}
		const exitCode = await runTests({
			extensionDevelopmentPath: extension,
			extensionTestsPath: path.join(
				repoRoot,
				"tests/vscode/activation.cjs",
			),
			launchArgs: [
				workspace,
				"--user-data-dir",
				path.join(root, "profile"),
				"--extensions-dir",
				path.join(root, "extensions"),
				"--skip-welcome",
				"--skip-release-notes",
				"--disable-workspace-trust",
			],
			extensionTestsEnv: {
				NERITA_DISTRIBUTION_TEST_EXTENSION: extension,
				...uiEnv,
			},
		});
		if (exitCode !== 0) {
			throw new Error("実 Extension Host の配布検証が失敗しました。");
		}
	} finally {
		await removeRun(root);
	}
}

/** 実 Webview でもモデル境界だけを代替し、設定と画像を実行ごとに分離する。 */
async function prepareWebview(root) {
	run("git", ["init", "--quiet", root], process.env);
	const home = path.join(root, "home");
	await fs.mkdir(home);
	await fs.mkdir(path.join(home, ".codex"));
	const model = path.join(root, "model.cjs");
	await build({
		entryPoints: [path.join(repoRoot, "tests/support/modelServer.ts")],
		outfile: model,
		bundle: true,
		platform: "node",
		format: "cjs",
	});
	const artifacts = path.join(
		repoRoot,
		"dist/ui-review",
		path.basename(root),
	);
	await fs.mkdir(artifacts, { recursive: true });
	return {
		HOME: home,
		USERPROFILE: home,
		HOMEDRIVE: path.parse(home).root.slice(0, 2),
		HOMEPATH: home.slice(2),
		PI_CODING_AGENT_DIR: path.join(home, ".pi/agent"),
		CODEX_HOME: path.join(home, ".codex"),
		NERITA_UI_MODEL: model,
		NERITA_UI_PROFILE: path.join(root, "profile"),
		NERITA_UI_ARTIFACTS: artifacts,
	};
}

/** 準備済みの実 Windows Sandbox を使用し、未準備を成功やスキップへ変換しない。 */
async function verifySandbox(extension, root) {
	const script = path.join(root, "sandbox.cjs");
	const fixture = path.join(root, "sandbox");
	await fs.mkdir(fixture);
	await build({
		absWorkingDir: repoRoot,
		entryPoints: ["tests/vscode/sandbox.ts"],
		outfile: script,
		bundle: true,
		platform: "node",
		format: "cjs",
		conditions: ["nerita-source"],
	});
	run(process.execPath, [script], {
		...process.env,
		NERITA_DISTRIBUTION_TEST_EXTENSION: extension,
		NERITA_WINDOWS_TEST_ROOT: fixture,
	});
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});

/** 自分で生成した展開領域だけを回収する。 */
async function removeRun(root) {
	if (
		path.dirname(root) !== os.tmpdir() ||
		!path.basename(root).startsWith("nerita-distribution-") ||
		(await fs.lstat(root)).isSymbolicLink()
	) {
		throw new Error("一時展開先を確認できません。");
	}
	await fs.rm(root, { recursive: true, force: true });
}
