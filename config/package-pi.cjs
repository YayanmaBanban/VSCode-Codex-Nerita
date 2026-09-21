// 公式のESMバンドルと相対参照資産を保ち、開発用node_modulesへの依存をなくす。
const fs = require("node:fs/promises");
const path = require("node:path");

/** 固定したPi SDKの配布済みバンドルをVSIXへ同梱する。 */
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
	const destination = path.join(target, "node_modules", manifest.name);
	await fs.mkdir(destination, { recursive: true });
	for (const name of ["package.json", "dist", "README.md"]) {
		await fs.cp(path.join(source, name), path.join(destination, name), {
			recursive: true,
			dereference: true,
		});
	}
	await fs.copyFile(
		path.join(__dirname, "licenses/pi-0.86.1/LICENSE"),
		path.join(destination, "LICENSE"),
	);
	// 公式バンドルでexternal指定される実行依存。chord/contextはesbuildを使用しない。
	for (const name of [
		"@earendil-works/chord",
		"typebox",
		"undici",
		"@silvia-odwyer/photon-node",
	]) {
		const dependency = path.resolve(source, "../..", name);
		const dependencyTarget = path.join(target, "node_modules", name);
		await fs.cp(dependency, dependencyTarget, {
			recursive: true,
			dereference: true,
			filter: (file) => path.basename(file) !== "node_modules",
		});
	}
}
module.exports = { copyPi };
