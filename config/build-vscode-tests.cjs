// 実機テストが移動後の Host 依存も読み込めるよう、検証用の入口をバンドルする。
const esbuild = require("esbuild");
const { repoRoot, extensionRequire } = require("./workspace-paths.cjs");

/** VS Code API だけを実機へ委ね、配布用と同じ条件で Host の依存を解決する。 */
async function main() {
	const context = await esbuild.context({
		absWorkingDir: repoRoot,
		entryPoints: ["tests/extension.test.ts"],
		outfile: "out/tests/extension.test.js",
		bundle: true,
		platform: "node",
		format: "cjs",
		target: "node22",
		sourcemap: true,
		conditions: ["nerita-source"],
		external: ["vscode"],
		alias: {
			"jsonc-parser": extensionRequire.resolve(
				"jsonc-parser/lib/esm/main.js",
			),
		},
		logLevel: "info",
	});
	if (process.argv.includes("--watch")) {
		await context.watch();
	} else {
		try {
			await context.rebuild();
		} finally {
			await context.dispose();
		}
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
