// UI の成果物を生成する。配布先への集約は呼び出し側から渡された処理に任せる。

/** 通常ビルドと監視ビルドで同じ設定と完了通知を使用する。 */
async function createUiBuild({
	production = false,
	onBuild,
	remote = false,
	entryPoint = process.env.NERITA_UI_ENTRY ?? "src/index.ts",
} = {}) {
	const { createViteUiBuild } = await import("./vite-build.mjs");
	return createViteUiBuild({ production, onBuild, entryPoint, remote });
}

/** UI パッケージ単独でビルドし、指定に応じて変更を監視する。 */
async function main() {
	const production = process.argv.includes("--production");
	const webview = await createUiBuild({ production });
	const remote = await createUiBuild({ production, remote: true });
	if (process.argv.includes("--watch")) {
		await Promise.all([webview.watch(), remote.watch()]);
	} else {
		try {
			await Promise.all([webview.rebuild(), remote.rebuild()]);
		} finally {
			await Promise.all([webview.dispose(), remote.dispose()]);
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
