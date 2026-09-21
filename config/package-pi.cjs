// Piの公開ESMエントリーと実行依存・相対参照資産をVSIXへ同梱する。
const fs = require("node:fs/promises");
const path = require("node:path");
const { copyRuntimePackage } = require("./copy-runtime-package.cjs");

/** SDK内部のファイル配置をHostに公開せず、ESM境界をビルド側で用意する。 */
async function copyPi(projectRoot, target) {
	const source = await fs.realpath(
		path.join(projectRoot, "node_modules/@earendil-works/pi-coding-agent"),
	);
	const manifest = JSON.parse(
		await fs.readFile(path.join(source, "package.json"), "utf8"),
	);
	if (
		require("../package.json").dependencies[manifest.name] !==
		manifest.version
	) {
		throw new Error("Pi SDKのバージョンを完全固定してください。");
	}
	await copyRuntimePackage(source, target);
	const destination = path.join(target, "node_modules", manifest.name);
	await fs.copyFile(
		path.join(__dirname, "licenses", `pi-${manifest.version}`, "LICENSE"),
		path.join(destination, "LICENSE"),
	);
	await fs.writeFile(
		path.join(target, "pi.mjs"),
		'// 公開エントリーのimport条件をNode.jsのESMローダーで解決する。\nexport * from "@earendil-works/pi-coding-agent";\n',
	);
}
module.exports = { copyPi };
