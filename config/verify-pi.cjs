// Pi 更新後の型・単体・配布・会話テストを順に実行し、展開済み VSIX も検証する。
const fs = require("node:fs/promises");
const path = require("node:path");
const { tmpdir } = require("node:os");
const { spawnSync } = require("node:child_process");
const { runPnpm } = require("./run-pnpm.cjs");

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
	for (const script of [
		"check",
		"test:unit",
		"test:runtime",
		"package:vsix",
		"test:pi:chat",
	]) {
		runPnpm(["run", script]);
	}
	const temporary = await fs.mkdtemp(
		path.join(tmpdir(), "nerita-pi-verify-"),
	);
	try {
		const result = spawnSync(
			"pwsh",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				"$ErrorActionPreference = 'Stop'; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:NERITA_VERIFY_VSIX, $env:NERITA_VERIFY_DIRECTORY)",
			],
			{
				stdio: "inherit",
				windowsHide: true,
				env: {
					...process.env,
					NERITA_VERIFY_VSIX: path.resolve(
						__dirname,
						"../dist/nerita.vsix",
					),
					NERITA_VERIFY_DIRECTORY: temporary,
				},
			},
		);
		if (result.error) {
			throw result.error;
		}
		if (result.status !== 0) {
			throw new Error("VSIXの展開に失敗しました。");
		}
		runPnpm(["run", "test:pi:chat", path.join(temporary, "extension")]);
	} finally {
		await removeTemporary(temporary);
	}
	console.log("Piの更新検証がすべて成功しました。");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
