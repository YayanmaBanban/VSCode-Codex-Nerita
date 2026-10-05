// Extension Host をビルドし、実行に必要な成果物だけを配布先へ集める。
const esbuild = require("esbuild");
const { watch: watchDirectory } = require("node:fs");
const { cp, copyFile, mkdir } = require("node:fs/promises");
const path = require("node:path");
const { repoRoot, extensionRoot } = require("../../config/workspace-paths.cjs");
const { packageRuntime } = require("../../config/package-runtime.cjs");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");
const dist = path.join(extensionRoot, "dist");
const uiRoot = path.join(repoRoot, "apps", "nerita-ui");
const brandAssets = ["nerita_store_icon.png", "nerita.svg", "nerita-24.svg"];

/** UI の再ビルドと独立してブランド資産を収集する。 */
async function collectBrandAssets() {
	await mkdir(path.join(dist, "media"), { recursive: true });
	await Promise.all(
		brandAssets.map((name) =>
			copyFile(
				path.join(uiRoot, "media", name),
				path.join(dist, "media", name),
			),
		),
	);
}

/** UI の完成した成果物と、VS Code が直接読むブランド資産を収集する。 */
async function collectUiArtifacts() {
	await cp(path.join(uiRoot, "dist"), path.join(dist, "webview"), {
		recursive: true,
		filter: (file) => !production || !file.endsWith(".map"),
	});
	await collectBrandAssets();
}

/** ソース内のスキーマとルートの配布文書を、拡張機能の配布先へコピーする。 */
async function collectPackageFiles() {
	await mkdir(dist, { recursive: true });
	await copyFile(
		path.join(
			repoRoot,
			"packages/shared/src/agentManager/handoff.schema.json",
		),
		path.join(dist, "handoff.schema.json"),
	);
	await copyFile(
		path.join(
			extensionRoot,
			"src/extension/backends/pi/guardrails/schema.json",
		),
		path.join(dist, "guardrails.schema.json"),
	);
	for (const name of ["README.md", "LICENSE", "CHANGELOG.md"]) {
		await copyFile(
			path.join(repoRoot, name),
			path.join(extensionRoot, name),
		);
	}
}

/** 通常は既存の UI 成果物を収集し、監視時だけ UI の再ビルドにも追従する。 */
async function main() {
	await collectPackageFiles();
	await packageRuntime();
	const host = await esbuild.context({
		absWorkingDir: extensionRoot,
		bundle: true,
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		logLevel: "info",
		conditions: ["nerita-source"],
		alias: { "jsonc-parser": "jsonc-parser/lib/esm/main.js" },
		entryPoints: ["src/extension/extension.ts"],
		format: "cjs",
		platform: "node",
		target: "node22",
		outfile: "dist/extension.js",
		external: ["vscode"],
	});
	if (watch) {
		// ディレクトリを監視し、エディターの原子的なファイル置換にも追従する。
		let collecting = Promise.resolve();
		watchDirectory(path.join(uiRoot, "media"), (_event, name) => {
			if (name !== null && !brandAssets.includes(String(name))) {
				return;
			}
			collecting = collecting
				.then(collectBrandAssets)
				.catch((error) => console.error(error));
		}).on("error", (error) => console.error(error));
		const { createUiBuild } = require("../nerita-ui/build.cjs");
		const webview = await createUiBuild({ onBuild: collectUiArtifacts });
		await Promise.all([host.watch(), webview.watch()]);
	} else {
		try {
			await collectUiArtifacts();
			await host.rebuild();
		} finally {
			await host.dispose();
		}
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
