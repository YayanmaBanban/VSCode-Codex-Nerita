// 直接依存の Codex で安定版の通信型を生成し、同じ版の配布用ライセンスを取得する。
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { extensionRequire } = require("./workspace-paths.cjs");
const { cleanupLicenses } = require("./cleanup-licenses.cjs");
const { runPnpm } = require("./run-pnpm.cjs");
const { readRequestedVersion } = require("./generate-version.cjs");

/** 公式リリースからライセンスを取得し、取得失敗時は生成物を更新せずに止める。 */
async function downloadLicenses(version) {
	const files = [];
	for (const name of ["LICENSE", "NOTICE"]) {
		const url = `https://raw.githubusercontent.com/openai/codex/rust-v${version}/${name}`;
		const response = await fetch(url, {
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) {
			throw new Error(
				`${name} の取得に失敗しました: HTTP ${response.status} (${url})`,
			);
		}
		const content = Buffer.from(await response.arrayBuffer());
		if (content.length === 0) {
			throw new Error(`${name} が空です: ${url}`);
		}
		files.push({ name, content });
	}
	return files;
}

/** 固定バージョンの通信型・ライセンス・生成元情報を更新する。 */
async function main() {
	const root = path.resolve(__dirname, "..");
	const requestedVersion = readRequestedVersion(
		"@openai/codex",
		"codex:generate",
	);
	if (requestedVersion !== undefined) {
		runPnpm([
			"--filter",
			"nerita",
			"add",
			"--save-exact",
			`@openai/codex@${requestedVersion}`,
		]);
	}
	const codexJson = extensionRequire.resolve("@openai/codex/package.json");
	const { version } = require(codexJson);
	if (requestedVersion !== undefined && requestedVersion !== version) {
		throw new Error(
			`指定した Codex ${requestedVersion} とインストール済みの ${version} が一致しません。`,
		);
	}
	if (
		require("../apps/vscode-nerita/package.json").dependencies[
			"@openai/codex"
		] !== version
	) {
		throw new Error(
			"直接依存の Codex を完全固定し、pnpm install を実行してください。",
		);
	}
	const licenses = await downloadLicenses(version);
	const out = path.join(
		root,
		"apps/vscode-nerita/src/extension/backends/codex/codex-app-server",
	);
	const result = spawnSync(
		process.execPath,
		[
			path.join(path.dirname(codexJson), "bin/codex.js"),
			"app-server",
			"generate-ts",
			"--out",
			out,
		],
		{ cwd: root, stdio: "inherit", windowsHide: true },
	);
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
	const licenseDirectory = path.join(
		__dirname,
		"licenses",
		`codex-${version}`,
	);
	fs.mkdirSync(licenseDirectory, { recursive: true });
	for (const { name, content } of licenses) {
		fs.writeFileSync(path.join(licenseDirectory, name), content);
	}
	fs.writeFileSync(
		path.join(out, "version.json"),
		`${JSON.stringify({ version, experimental: false }, null, 2)}\n`,
	);
	await cleanupLicenses(path.join(__dirname, "licenses"), "codex", version);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
