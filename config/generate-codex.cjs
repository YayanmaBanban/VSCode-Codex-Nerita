// 直接依存の Codex で安定版の通信型を生成し、同じ版の配布用ライセンスを取得する。
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { cleanupLicenses } = require("./cleanup-licenses.cjs");

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
	const requestedVersion = readRequestedVersion();
	installRequestedVersion(requestedVersion, root);
	const codexJson = require.resolve("@openai/codex/package.json");
	const { version } = require(codexJson);
	if (requestedVersion !== undefined && requestedVersion !== version) {
		throw new Error(
			`指定した Codex ${requestedVersion} とインストール済みの ${version} が一致しません。`,
		);
	}
	if (require("../package.json").dependencies["@openai/codex"] !== version) {
		throw new Error(
			"直接依存の Codex を完全固定し、pnpm install を実行してください。",
		);
	}
	const licenses = await downloadLicenses(version);
	const out = path.join(
		root,
		"src/extension/backends/codex/codex-app-server",
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

/** 生成コマンドのバージョン引数を検証する。 */
function readRequestedVersion() {
	const args = process.argv.slice(2);
	const requestedVersion = args[0];
	if (
		args.length > 1 ||
		(requestedVersion !== undefined &&
			!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(requestedVersion))
	) {
		throw new Error(
			"使い方: pnpm codex:generate [バージョン（例: 0.156.0）]",
		);
	}
	return requestedVersion;
}

/** 指定された Codex の固定版を pnpm で導入する。 */
function installRequestedVersion(requestedVersion, root) {
	if (requestedVersion !== undefined) {
		const pnpmPath = process.env.npm_execpath;
		if (
			!pnpmPath ||
			!process.env.npm_config_user_agent?.startsWith("pnpm/")
		) {
			throw new Error(
				"依存の更新は pnpm codex:generate <バージョン> で実行してください。",
			);
		}
		const standalone = path.extname(pnpmPath).toLowerCase() === ".exe";
		const install = spawnSync(
			standalone ? pnpmPath : process.execPath,
			[
				...(standalone ? [] : [pnpmPath]),
				"add",
				"--save-exact",
				`@openai/codex@${requestedVersion}`,
			],
			{ cwd: root, stdio: "inherit", windowsHide: true },
		);
		if (install.error) {
			throw install.error;
		}
		if (install.status !== 0) {
			process.exit(install.status ?? 1);
		}
	}
}
