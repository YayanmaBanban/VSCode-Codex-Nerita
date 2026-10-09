// 本番 VSIX と独立した VS Code プロファイルで履歴表示のメモリを測る。
const fs = require("node:fs/promises");
const { createReadStream, createWriteStream } = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { once } = require("node:events");
const { spawn, execFileSync } = require("node:child_process");

const repo = path.resolve(__dirname, "../..");
const dist = path.join(repo, "dist");

/** 元の履歴を読み、作業ディレクトリだけを専用環境に差し替えたコピーを作る。 */
async function copyHistory(source, root) {
	const lines = readline.createInterface({ input: createReadStream(source) });
	let output;
	let metadata;
	try {
		for await (const line of lines) {
			const row = JSON.parse(line);
			if (row.type === "session_meta") {
				metadata = {
					id: row.payload.id,
					bytes: (await fs.stat(source)).size,
				};
				const date = row.payload.timestamp.slice(0, 10).split("-");
				const directory = path.join(
					root,
					"home/.codex/sessions",
					...date,
				);
				await fs.mkdir(directory, { recursive: true });
				output = createWriteStream(
					path.join(directory, path.basename(source)),
				);
			}
			if (!output) {
				throw new Error("履歴の先頭に session_meta がありません");
			}
			const rewritten =
				["session_meta", "turn_context", "world_state"].includes(
					row.type,
				) || row.payload?.type === "thread_settings_applied";
			if (rewritten) {
				rewriteWorkspace(row.payload, path.join(root, "workspace"));
			}
			if (!output.write(`${rewritten ? JSON.stringify(row) : line}\n`)) {
				await once(output, "drain");
			}
		}
		output.end();
		await once(output, "finish");
		return metadata;
	} finally {
		lines.close();
		output?.destroy();
	}
}

/** 保存済みの環境と設定にある作業場所を揃え、会話本文やツール出力は変更しない。 */
function rewriteWorkspace(value, workspace) {
	if (!value || typeof value !== "object") {
		return;
	}
	for (const [key, child] of Object.entries(value)) {
		if (key === "cwd") {
			value[key] = workspace;
		} else if (
			["workspace_roots", "runtime_workspace_roots"].includes(key)
		) {
			value[key] = [workspace];
		} else {
			rewriteWorkspace(child, workspace);
		}
	}
}

/** 生成済み VSIX を展開し、認証不要のローカル設定と検証用拡張を用意する。 */
async function prepare(root, source) {
	await fs.mkdir(path.join(root, "workspace"));
	await fs.mkdir(path.join(root, "profile/User"), { recursive: true });
	await fs.copyFile(
		path.join(repo, "apps/vscode-nerita/dist/nerita.vsix"),
		path.join(root, "extension.zip"),
	);
	await fs.mkdir(path.join(root, "package"));
	execFileSync(
		"tar.exe",
		[
			"-xf",
			path.join(root, "extension.zip"),
			"-C",
			path.join(root, "package"),
		],
		{ windowsHide: true },
	);
	const history = await copyHistory(source, root);
	await fs.writeFile(
		path.join(root, "home/.codex/config.toml"),
		[
			'model_provider="memory"',
			'model="gpt-6-astra"',
			"[model_providers.memory]",
			'name="Memory measurement"',
			'base_url="http://127.0.0.1:9/v1"',
			'wire_api="responses"',
			"requires_openai_auth=false",
			"",
		].join("\n"),
	);
	await fs.writeFile(
		path.join(root, "profile/User/settings.json"),
		JSON.stringify({
			"nerita.backend": "codex",
			"window.dialogStyle": "custom",
			"workbench.startupEditor": "none",
			"workbench.colorTheme": "Default Dark Modern",
			"telemetry.telemetryLevel": "off",
			"update.mode": "none",
			"extensions.autoUpdate": false,
		}),
	);
	const helper = path.join(root, "driver");
	await fs.mkdir(helper);
	await fs.writeFile(
		path.join(helper, "package.json"),
		JSON.stringify({
			name: "nerita-memory-driver",
			publisher: "local",
			version: "0.0.1",
			engines: { vscode: "^1.137.0" },
			main: "./main.cjs",
			activationEvents: ["onStartupFinished"],
		}),
	);
	await fs.copyFile(
		path.join(repo, "tests/vscode/driver.cjs"),
		path.join(helper, "main.cjs"),
	);
	return history;
}

/** 利用中の VS Code の環境変数や認証情報を計測用プロセスへ引き継がない。 */
function environment(root, artifacts, history) {
	const env = { ...process.env };
	for (const name of [
		"OPENAI_API_KEY",
		"CODEX_API_KEY",
		"VSCODE_PID",
		"ELECTRON_RUN_AS_NODE",
		"NODE_OPTIONS",
		"CODEX_SQLITE_HOME",
	]) {
		delete env[name];
	}
	return {
		...env,
		CODEX_HOME: path.join(root, "home/.codex"),
		USERPROFILE: path.join(root, "home"),
		HOME: path.join(root, "home"),
		NERITA_UI_ENTRY: path.join(__dirname, "vscode-chat-memory-driver.cjs"),
		NERITA_UI_RESULT: path.join(root, "ui-result.json"),
		NERITA_UI_PROFILE: path.join(root, "profile"),
		NERITA_UI_ARTIFACTS: artifacts,
		NERITA_MEMORY_HISTORY: JSON.stringify(history),
		NERITA_MEMORY_MODE: process.argv[3] ?? "controlled",
	};
}

/** キャッシュ済みのエディターを起動し、終了時まで専用プロセスを管理する。 */
async function launch(root, artifacts, history) {
	const cache = path.join(repo, ".vscode-test");
	const versions = (await fs.readdir(cache)).filter((name) =>
		name.startsWith("vscode-win32-x64-archive-"),
	);
	versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
	const executable = path.join(cache, versions.at(-1), "Code.exe");
	const child = spawn(
		executable,
		[
			path.join(root, "workspace"),
			`--extensionDevelopmentPath=${path.join(root, "package/extension")}`,
			`--extensionDevelopmentPath=${path.join(root, "driver")}`,
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
			windowsHide: true,
			env: environment(root, artifacts, history),
			stdio: "inherit",
		},
	);
	const timer = setTimeout(() => {
		execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
			windowsHide: true,
			stdio: "ignore",
		});
	}, 240000);
	try {
		const [code] = await once(child, "exit");
		if (code !== 0) {
			throw new Error(`計測用 VS Code の終了コード: ${code}`);
		}
	} finally {
		clearTimeout(timer);
	}
	const report = JSON.parse(
		await fs.readFile(path.join(root, "ui-result.json"), "utf8"),
	);
	if (!report.passed) {
		throw new Error(report.error);
	}
}

/** 成果物を残し、一時プロファイルは dist 内の確認済みディレクトリだけ削除する。 */
async function main() {
	await fs.mkdir(dist, { recursive: true });
	const source = process.argv[2];
	if (!source) {
		throw new Error("履歴 JSONL を引数で指定してください");
	}
	const root = await fs.mkdtemp(path.join(dist, "vscode-memory-"));
	const artifacts = path.join(
		dist,
		"ui-review",
		`nerita-distribution-memory-${Date.now()}`,
	);
	await fs.mkdir(artifacts, { recursive: true });
	try {
		const history = await prepare(root, source);
		console.log(
			"Memory measurement",
			history,
			path.relative(repo, artifacts),
		);
		await launch(root, artifacts, history);
		console.log("Measurement completed", path.relative(repo, artifacts));
	} finally {
		await removeTemporaryRoot(root);
	}
}

/** 削除対象が作成した dist 直下のディレクトリであることを確認する。 */
async function removeTemporaryRoot(root) {
	if (path.dirname(path.resolve(root)) !== dist) {
		throw new Error("一時ディレクトリが dist の外にあります");
	}
	await fs.rm(root, {
		recursive: true,
		force: true,
		maxRetries: 6,
		retryDelay: 1000,
	});
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
