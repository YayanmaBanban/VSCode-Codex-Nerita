// Pi 更新後の型・単体・配布・会話テストを順に実行し、展開済み VSIX も検証する。
const fs = require("node:fs/promises");
const path = require("node:path");
const { tmpdir } = require("node:os");
const { spawnSync } = require("node:child_process");
const { repoRoot, extensionRoot } = require("./workspace-paths.cjs");
const { runPnpm } = require("./run-pnpm.cjs");

/** Windows 標準の展開コマンドを実行し、欠落や失敗をその工程で報告する。 */
function runTar(args) {
	const result = spawnSync("tar.exe", args, {
		stdio: "inherit",
		windowsHide: true,
	});
	if (result.error) {
		throw new Error("VSIXの検証に必要なtar.exeを起動できません。", {
			cause: result.error,
		});
	}
	if (result.status !== 0) {
		throw new Error("VSIXの展開コマンドが失敗しました。");
	}
}

/** 実認証と区別した配布ファクトリーの検査を、開発時と VSIX 内で共通に実行する。 */
function runFeatureSmoke(extensionPath, script) {
	const result = spawnSync(
		process.execPath,
		[path.join(repoRoot, "tests", script), extensionPath],
		{ stdio: "inherit", windowsHide: true },
	);
	if (result.error || result.status !== 0) {
		throw new Error("Pi の新機能に必要な配布 runtime を検証できません。", {
			cause: result.error,
		});
	}
}

/** 検証専用の一時ディレクトリであることを確認して削除する。 */
async function removeTemporary(temporary) {
	if (
		path.dirname(temporary) !== tmpdir() ||
		!path.basename(temporary).startsWith("nerita-pi-verify-") ||
		(await fs.lstat(temporary)).isSymbolicLink()
	) {
		throw new Error("一時展開先の安全確認に失敗しました。");
	}
	await fs.rm(temporary, { recursive: true, force: true });
}

/** 各工程の失敗で停止し、この実行で作成した一時展開先だけを削除する。 */
async function main() {
	if (process.argv.length > 2) {
		throw new Error("使い方: pnpm pi:verify（引数なし）");
	}
	if (process.platform !== "win32" || process.arch !== "x64") {
		throw new Error("Piの配布検証にはWindows x64が必要です。");
	}
	// ビルド後に展開コマンドの欠落で失敗しないよう、検証前に確認する。
	runTar(["--version"]);
	for (const script of [
		"check",
		"test:host",
		"test:runtime",
		"package:vsix",
		"test:pi:chat",
	]) {
		runPnpm(["run", script]);
	}
	runFeatureSmoke(extensionRoot, "pi-feature-runtime-smoke.mjs");
	runFeatureSmoke(extensionRoot, "pi-mcp-smoke.mjs");
	const temporary = await fs.mkdtemp(
		path.join(tmpdir(), "nerita-pi-verify-"),
	);
	try {
		runTar([
			"-xf",
			path.resolve(__dirname, "../apps/vscode-nerita/dist/nerita.vsix"),
			"-C",
			temporary,
		]);
		runPnpm(["run", "test:pi:chat", path.join(temporary, "extension")]);
		runFeatureSmoke(
			path.join(temporary, "extension"),
			"pi-feature-runtime-smoke.mjs",
		);
		runFeatureSmoke(path.join(temporary, "extension"), "pi-mcp-smoke.mjs");
	} finally {
		await removeTemporary(temporary);
	}
	console.log("Piの更新検証がすべて成功しました。");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
