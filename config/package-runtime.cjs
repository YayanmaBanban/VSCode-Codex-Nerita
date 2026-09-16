// pnpm のリンク構造に依存しない実行資産を dist/runtime に配置する。
const fs = require("node:fs/promises");
const path = require("node:path");
const { createRequire } = require("node:module");

/** 指定した Codex とネイティブ資産を、pnpm のリンクから独立して同梱する。 */
async function copyCodex(codexJson, target) {
	const codexRequire = createRequire(codexJson);
	const platformName = "@openai/codex-win32-x64";
	const platformJson = codexRequire.resolve(`${platformName}/package.json`);
	// 動的 require.resolve が参照する npm パッケージ構造を維持する。
	for (const [name, json] of [
		["@openai/codex", codexJson],
		[platformName, platformJson],
	]) {
		const root = path.dirname(json);
		const destination = path.join(target, "node_modules", name);
		await fs.mkdir(destination, { recursive: true });
		await fs.copyFile(json, path.join(destination, "package.json"));
		for (const entry of await fs.readdir(root, { withFileTypes: true })) {
			if (
				["bin", "vendor", "LICENSE", "README.md"].includes(entry.name)
			) {
				await fs.cp(
					path.join(root, entry.name),
					path.join(destination, entry.name),
					{ recursive: true, dereference: true },
				);
			}
		}
	}
}

/** このプロジェクトの生成物だけを消し、旧バイナリの混入を防ぐ。 */
async function resetRuntime(projectRoot) {
	const dist = path.join(projectRoot, "dist");
	const target = path.join(dist, "runtime");
	await fs.mkdir(dist, { recursive: true });
	// distやruntimeが別の場所へのリンクなら、再帰削除を行わずビルドを止める。
	if (
		(await fs.realpath(dist)) !== dist ||
		path.relative(projectRoot, target) !== path.join("dist", "runtime")
	) {
		throw new Error(
			"runtimeの出力先がプロジェクト内の生成先ではありません。",
		);
	}
	try {
		if ((await fs.lstat(target)).isSymbolicLink()) {
			throw new Error("runtimeにリンクは使用できません。");
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

/** 直接依存と生成型のバージョンを揃え、App Server用の資産だけを同梱する。 */
async function packageRuntime() {
	if (process.platform !== "win32" || process.arch !== "x64") {
		throw new Error("VSIX のビルドには Windows x64 が必要です。");
	}
	const codexJson = require.resolve("@openai/codex/package.json");
	const { version } = require(codexJson);
	const generated = require("../src/codex-app-server/version.json");
	if (
		require("../package.json").dependencies["@openai/codex"] !== version ||
		generated.version !== version ||
		generated.experimental !== false
	) {
		throw new Error(
			"Codex の依存を完全固定し、pnpm codex:generate を実行してください。",
		);
	}
	// 入力パッケージを解決してから生成先を更新する。
	createRequire(codexJson).resolve("@openai/codex-win32-x64/package.json");
	const notices = path.join(__dirname, "licenses", `codex-${version}`);
	for (const name of ["LICENSE", "NOTICE"]) {
		await fs.access(path.join(notices, name));
	}
	const projectRoot = await fs.realpath(path.resolve(__dirname, ".."));
	const target = await resetRuntime(projectRoot);
	await copyCodex(codexJson, target);
	// npm配布に含まれない上流のライセンス表記を、固定バージョンの資産と一緒に残す。
	for (const name of ["LICENSE", "NOTICE"]) {
		await fs.copyFile(
			path.join(notices, name),
			path.join(target, "node_modules/@openai/codex", name),
		);
	}
}
module.exports = { packageRuntime };
