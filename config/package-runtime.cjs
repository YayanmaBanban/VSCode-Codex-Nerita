// pnpm のリンク構造に依存しない実行資産を dist/runtime に配置する。
const fs = require("node:fs/promises");
const path = require("node:path");
const { extensionRoot, extensionRequire } = require("./workspace-paths.cjs");
const { bundlePi } = require("./package-pi.cjs");
const { packageMxc } = require("./package-mxc.cjs");

/** このプロジェクトの生成物だけを消し、旧バイナリの混入を防ぐ。 */
async function resetRuntime(projectRoot) {
	const dist = path.join(projectRoot, "dist");
	const target = path.join(dist, "runtime");
	await fs.mkdir(dist, { recursive: true });
	// `dist` や `runtime` が別の場所へのリンクなら、再帰削除を行わずビルドを止める。
	const unsafeDistribution =
		(await fs.realpath(dist)) !== dist ||
		path.relative(projectRoot, target) !== path.join("dist", "runtime");
	if (unsafeDistribution) {
		throw new Error(
			"ランタイムの出力先が所定の dist/runtime ではないか、リンクを経由しています。",
		);
	}
	try {
		const linkedTarget = (await fs.lstat(target)).isSymbolicLink();
		if (linkedTarget) {
			throw new Error(
				"ランタイムの出力先にシンボリックリンクは使用できません。",
			);
		}
	} catch (error) {
		if (error.code !== "ENOENT") {
			throw error;
		}
	}
	await fs.rm(target, { recursive: true, force: true });
	await fs.mkdir(target, { recursive: true });
	return target;
}

/** 対応版を照合し、Codex の取得情報・ライセンスと Pi・MXC の実行資産を収集する。 */
async function packageRuntime() {
	if (process.platform !== "win32" || process.arch !== "x64") {
		throw new Error("VSIX のビルドには Windows x64 が必要です。");
	}
	const codexJson = extensionRequire.resolve("@openai/codex/package.json");
	const { version } = require(codexJson);
	const generated = require("../apps/vscode-nerita/src/extension/backends/codex/codex-app-server/version.json");
	const matchesMetadata =
		generated.experimental === false &&
		Boolean(generated.runtime?.integrity);
	if (
		require("../apps/vscode-nerita/package.json").dependencies[
			"@openai/codex"
		] !== version ||
		generated.version !== version ||
		!matchesMetadata
	) {
		throw new Error(
			"Codex の依存バージョンを固定し、pnpm codex:generate でバージョン情報と配布設定を再生成してください。",
		);
	}
	// 入力パッケージを解決してから生成先を更新する。
	const notices = path.join(__dirname, "licenses", `codex-${version}`);
	for (const name of ["LICENSE", "NOTICE"]) {
		await fs.access(path.join(notices, name));
	}
	const projectRoot = await fs.realpath(extensionRoot);
	const target = await resetRuntime(projectRoot);
	const codex = path.join(target, "codex");
	await fs.mkdir(codex);
	await fs.writeFile(
		path.join(codex, "version.json"),
		JSON.stringify(generated),
	);
	await bundlePi(projectRoot, target);
	await packageMxc(target);
	// npm 配布に含まれない上流のライセンス表記を、固定バージョンの資産と一緒に残す。
	for (const name of ["LICENSE", "NOTICE"]) {
		await fs.copyFile(path.join(notices, name), path.join(codex, name));
	}
}
module.exports = { packageRuntime };
