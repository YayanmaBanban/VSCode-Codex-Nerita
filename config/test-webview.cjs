// VS Code のテストモードは確認ダイアログを禁止するため、補助拡張から受入を実行する。
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { downloadAndUnzipVSCode } = require("@vscode/test-electron");
const { repoRoot } = require("./workspace-paths.cjs");

/** 利用者のプロファイルへ入れず、展開物と受入用の補助拡張だけを起動する。 */
async function launch(extension, root, environment) {
	const helper = path.join(root, "acceptance-driver");
	await fs.mkdir(helper);
	await fs.writeFile(
		path.join(helper, "package.json"),
		JSON.stringify({
			name: "nerita-acceptance-driver",
			publisher: "local",
			version: "0.0.1",
			engines: require(path.join(extension, "package.json")).engines,
			main: "./main.cjs",
			activationEvents: ["onStartupFinished"],
		}),
	);
	await fs.copyFile(
		path.join(repoRoot, "tests/vscode/driver.cjs"),
		path.join(helper, "main.cjs"),
	);
	const resultFile = path.join(root, "ui-result.json");
	const executable = await downloadAndUnzipVSCode();
	await runEditor(
		executable,
		[
			path.join(root, "workspace"),
			`--extensionDevelopmentPath=${extension}`,
			`--extensionDevelopmentPath=${helper}`,
			"--user-data-dir",
			path.join(root, "profile"),
			"--extensions-dir",
			path.join(root, "extensions"),
			"--skip-welcome",
			"--skip-release-notes",
			"--disable-workspace-trust",
			"--remote-debugging-port=0",
		],
		{
			env: {
				...process.env,
				...environment,
				NERITA_DISTRIBUTION_TEST_EXTENSION: extension,
				NERITA_UI_ENTRY: path.join(
					repoRoot,
					"tests/vscode/activation.cjs",
				),
				NERITA_UI_RESULT: resultFile,
			},
			windowsHide: true,
			stdio: "inherit",
		},
	);
	const report = JSON.parse(await fs.readFile(resultFile, "utf8"));
	if (!report.passed) {
		throw new Error(report.error);
	}
	console.log("実 Webview の受入: 成功", environment.NERITA_UI_ARTIFACTS);
}

/** 期限切れでも起動したウィンドウと Host のプロセスツリーを回収する。 */
async function runEditor(executable, args, options) {
	const child = spawn(executable, args, options);
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		if (child.pid) {
			spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
				windowsHide: true,
				stdio: "ignore",
			});
		}
	}, 180000);
	try {
		const [code] = await once(child, "exit");
		if (timedOut || code !== 0) {
			throw new Error("実 Webview の起動・終了に失敗しました。");
		}
	} finally {
		clearTimeout(timer);
	}
}

module.exports = { launch };
