// UI の成果物を生成する。配布先への集約は呼び出し側から渡された処理に任せる。
const esbuild = require("esbuild");
const path = require("node:path");
const { tailwindPlugin } = require("./tailwind-esbuild.cjs");

/** 通常ビルドと監視ビルドで同じ設定と完了通知を使用する。 */
function createUiBuild({ production = false, onBuild } = {}) {
	return esbuild.context({
		absWorkingDir: __dirname,
		entryPoints: ["src/index.tsx"],
		outfile: "dist/index.js",
		bundle: true,
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		logLevel: "info",
		conditions: ["nerita-source"],
		loader: { ".svg": "text" },
		format: "iife",
		platform: "browser",
		target: "es2022",
		plugins: [
			tailwindPlugin(),
			{
				name: "ui-artifacts",
				setup(build) {
					build.onEnd(async (result) => {
						if (result.errors.length === 0 && onBuild) {
							await onBuild(path.join(__dirname, "dist"));
						}
					});
				},
			},
		],
	});
}

/** UI パッケージ単独でビルドし、指定に応じて変更を監視する。 */
async function main() {
	const context = await createUiBuild({
		production: process.argv.includes("--production"),
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

if (require.main === module) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
module.exports = { createUiBuild };
