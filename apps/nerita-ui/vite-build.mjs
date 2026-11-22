// Vite の静的成果物を、既存の UI ビルド・監視・配布通知へ接続する。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

const uiRoot = path.dirname(fileURLToPath(import.meta.url));
const remoteRoot = path.join(uiRoot, "src", "remote");
export const remoteOutDir = path.resolve(uiRoot, "../../dist/remote-ui");

/** 固定の入口・CSS と相対アセットを生成し、配布先への同期は呼び出し側に任せる。 */
export function createViteUiBuild({ production, onBuild, entryPoint, remote }) {
	let watcher;
	const [root, outDir] = remote
		? [remoteRoot, remoteOutDir]
		: [uiRoot, path.join(uiRoot, "dist")];
	const config = {
		root,
		mode: production ? "production" : "development",
		configFile: false,
		base: "./",
		publicDir: false,
		resolve: {
			conditions: resolutionConditions(production),
			dedupe: ["svelte"],
		},
		plugins: [
			svelte({ configFile: false }),
			tailwindcss(),
			{
				name: "nerita-ui-artifacts",
				async writeBundle() {
					await onBuild?.(outDir);
				},
			},
		],
		build: {
			outDir,
			emptyOutDir: true,
			assetsInlineLimit: 0,
			cssCodeSplit: false,
			sourcemap: !production,
			minify: production,
			target: "es2022",
			modulePreload: false,
			rolldownOptions: {
				input: path.resolve(root, remote ? "index.html" : entryPoint),
				output: {
					// 入力エディターを共通画面のチャンクから分ける。
					codeSplitting: {
						groups: [
							{
								name: "lexical",
								test: /[/\\]node_modules[/\\](?:@lexical[/\\]|lexical[/\\])/,
							},
						],
					},
					entryFileNames: "index.js",
					chunkFileNames: "chunks/[name]-[hash].js",
					assetFileNames: assetName,
					sourcemapExcludeSources: true,
				},
			},
		},
	};

	return {
		async rebuild() {
			await build(config);
		},
		async watch() {
			watcher = await build({
				...config,
				build: { ...config.build, watch: {} },
			});
			// watch の初回失敗も成功した起動として扱わず、配布完了まで待つ。
			await new Promise((resolve, reject) => {
				watcher.on("event", (event) => {
					if (event.code === "ERROR") {
						reject(event.error);
					} else if (event.code === "END") {
						resolve();
					}
				});
			});
		},
		async dispose() {
			await watcher?.close();
		},
	};
}

/** Webview とモバイルの双方で同じ共有パッケージのソースを解決する。 */
function resolutionConditions(production) {
	return [
		"nerita-source",
		"module",
		"browser",
		production ? "production" : "development",
	];
}

/** CSS は Host の固定 URI に合わせ、その他の資産はビルド先からの相対参照にする。 */
function assetName(asset) {
	if (asset.names.some((name) => name.endsWith(".css"))) {
		return "index.css";
	}
	return "assets/[name]-[hash][extname]";
}
