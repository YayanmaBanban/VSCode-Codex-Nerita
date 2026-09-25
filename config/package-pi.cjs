// Pi を専用の ESM エントリーポイントと遅延読込用チャンクへまとめ、実行時にファイルとして読む資産を同梱する。
const fs = require("node:fs/promises");
const path = require("node:path");
const { build } = require("esbuild");
const { piBundlePlugin } = require("./pi-bundle-plugin.cjs");
const { copyBundleLicenses } = require("./pi-bundle-licenses.cjs");
const { verifyPiSources } = require("./pi-sdk-contract.cjs");

const { version: SUPPORTED_PI_VERSION } = require("./pi-version.json");

/** WASM 実行に必要なファイルだけを保持する。 */
async function copyPhoton(sdkRoot, target) {
	const source = await fs.realpath(
		path.join(sdkRoot, "../../@silvia-odwyer/photon-node"),
	);
	const destination = path.join(
		target,
		"node_modules/@silvia-odwyer/photon-node",
	);
	await fs.mkdir(destination, { recursive: true });
	for (const name of ["package.json", "photon_rs.js", "photon_rs_bg.wasm"]) {
		await fs.copyFile(
			path.join(source, name),
			path.join(destination, name),
		);
	}
	return source;
}

/** SDK が相対パスで資産を見つけられるよう、配布先に package.json と必要なファイルを配置する。 */
async function copyAssets(source, destination, manifest) {
	await fs.writeFile(
		path.join(destination, "package.json"),
		JSON.stringify({
			name: manifest.name,
			version: manifest.version,
			type: "module",
			piConfig: manifest.piConfig,
		}),
	);
	for (const name of [
		"dist/modes/interactive/theme",
		"dist/modes/interactive/assets",
		"dist/core/export-html/template.html",
		"dist/core/export-html/template.css",
		"dist/core/export-html/template.js",
		"dist/core/export-html/vendor",
		"docs",
		"README.md",
		"CHANGELOG.md",
	]) {
		await fs.cp(path.join(source, name), path.join(destination, name), {
			recursive: true,
			filter: (file) => !file.endsWith(".map") && !file.endsWith(".d.ts"),
		});
	}
	await fs.copyFile(
		path.join(__dirname, "licenses", `pi-${manifest.version}`, "LICENSE"),
		path.join(destination, "LICENSE"),
	);
}

/** Host が SDK 内部の配置に依存せず読み込める、専用の ESM バンドルを生成する。 */
async function bundlePi(projectRoot, target) {
	const source = await fs.realpath(
		path.join(projectRoot, "node_modules/@earendil-works/pi-coding-agent"),
	);
	const manifest = JSON.parse(
		await fs.readFile(path.join(source, "package.json"), "utf8"),
	);
	const aiRoot = await fs.realpath(path.join(source, "../pi-ai"));
	const aiManifest = JSON.parse(
		await fs.readFile(path.join(aiRoot, "package.json"), "utf8"),
	);
	if (
		manifest.version !== SUPPORTED_PI_VERSION ||
		aiManifest.version !== SUPPORTED_PI_VERSION ||
		require("../package.json").dependencies[manifest.name] !==
			manifest.version
	) {
		throw new Error("Pi SDKのバージョンを完全固定してください。");
	}
	await verifyPiSources({ sdk: source, ai: aiRoot });
	const destination = path.join(target, "pi");
	const result = await build({
		absWorkingDir: projectRoot,
		entryPoints: {
			core: path.join(__dirname, "runtime/pi-entry.mjs"),
			"image-resize-worker": path.join(
				source,
				"dist/utils/image-resize-worker.js",
			),
		},
		outdir: destination,
		outExtension: { ".js": ".mjs" },
		chunkNames: "[name]-[hash]",
		bundle: true,
		splitting: true,
		format: "esm",
		platform: "node",
		target: "node22",
		minify: true,
		metafile: true,
		legalComments: "linked",
		define: { PI_BUNDLED_NODE: "true" },
		// CJS 依存の Node 組込 `require` を各チャンクで利用できるようにする。
		banner: {
			js: 'import { createRequire as __neritaCreateRequire } from "node:module"; const require = __neritaCreateRequire(import.meta.url);',
		},
		external: ["@silvia-odwyer/photon-node"],
		plugins: [piBundlePlugin(source, aiRoot)],
	});
	await copyAssets(source, destination, manifest);
	const photonRoot = await copyPhoton(source, target);
	await copyBundleLicenses(
		projectRoot,
		destination,
		result.metafile,
		photonRoot,
	);
	await fs.writeFile(
		path.join(target, "pi.mjs"),
		'export * from "./pi/core.mjs";\n',
	);
	await fs.writeFile(
		path.join(destination, "bundle-meta.json"),
		JSON.stringify(result.metafile),
	);
	return result.metafile;
}
module.exports = { bundlePi, SUPPORTED_PI_VERSION };
