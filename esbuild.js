// Extension Host とブラウザを個別にバンドルし、実行依存を同梱する。
const esbuild = require("esbuild");
const { tailwindPlugin } = require("./config/tailwind-esbuild.cjs");
const { packageRuntime } = require("./config/package-runtime.cjs");
const { copyFile, mkdir } = require("node:fs/promises");
const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");
/** 両方の出力を生成し、監視時も同じ構成を利用する。 */
async function main() {
	await mkdir("dist", { recursive: true });
	await copyFile(
		"src/extension/backends/pi/guardrails/schema.json",
		"dist/guardrails.schema.json",
	);
	const common = {
		bundle: true,
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		logLevel: "info",
	};
	const host = await esbuild.context({
		...common,
		entryPoints: ["src/extension/extension.ts"],
		format: "cjs",
		platform: "node",
		target: "node22",
		outfile: "dist/extension.js",
		external: ["vscode"],
	});
	const webview = await esbuild.context({
		...common,
		entryPoints: ["src/webview/index.tsx"],
		loader: { ".svg": "text" },
		plugins: [tailwindPlugin()],
		format: "iife",
		platform: "browser",
		target: "es2022",
		outfile: "dist/webview/index.js",
	});
	await packageRuntime();
	if (watch) {
		await Promise.all([host.watch(), webview.watch()]);
	} else {
		try {
			await Promise.all([host.rebuild(), webview.rebuild()]);
		} finally {
			await Promise.all([host.dispose(), webview.dispose()]);
		}
	}
}
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
