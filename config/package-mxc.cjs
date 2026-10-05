// MXC の ESM・worker・ネイティブ資産を、SDK が期待する npm 構造のまま同梱する。
const fs = require("node:fs/promises");
const path = require("node:path");
const { createRequire } = require("node:module");
const { extensionRequire } = require("./workspace-paths.cjs");

/** ネイティブモジュールはバンドルせず、固定済みの依存ツリーをコピーする。 */
async function packageMxc(target) {
	const copied = new Set();
	async function copyPackage(json) {
		const manifest = JSON.parse(await fs.readFile(json, "utf8"));
		if (copied.has(manifest.name)) {
			return;
		}
		copied.add(manifest.name);
		const root = path.dirname(json);
		await fs.cp(root, path.join(target, "node_modules", manifest.name), {
			recursive: true,
			dereference: true,
			filter: (entry) =>
				runtimeAsset(manifest.name, path.relative(root, entry)),
		});
		const resolve = createRequire(json);
		const dependencies = Object.keys(manifest.dependencies ?? {});
		if (manifest.name === "koffi") {
			dependencies.push("@koromix/koffi-win32-x64");
		}
		for (const name of dependencies) {
			let directory = path.dirname(resolve.resolve(name));
			while (true) {
				const candidate = path.join(directory, "package.json");
				const entry = await fs
					.readFile(candidate, "utf8")
					.catch((error) => {
						if (error.code !== "ENOENT") {
							throw error;
						}
						return "{}";
					});
				if (JSON.parse(entry).name === name) {
					await copyPackage(candidate);
					break;
				}
				const parent = path.dirname(directory);
				if (parent === directory) {
					throw new Error(`依存パッケージを解決できません: ${name}`);
				}
				directory = parent;
			}
		}
	}
	await copyPackage(
		extensionRequire.resolve("@microsoft/mxc-sdk/package.json"),
	);
}

module.exports = { packageMxc };

/** 対象は Windows x64。SDK の署名検証用マニフェストと動的インポート先は残す。 */
function runtimeAsset(name, relative) {
	const parts = relative.split(path.sep);
	if (parts.includes("node_modules")) {
		return false;
	}
	if (name === "@microsoft/mxc-sdk" && parts[0] === "bin") {
		return windowsMxcAsset(parts);
	}
	if (name === "node-pty" && parts[0] === "prebuilds") {
		return parts.length === 1 || parts[1] === "win32-x64";
	}
	return true;
}

/** Windows の実行ファイル・DLL と署名情報を、SDK 内の配置を変えずに選ぶ。 */
function windowsMxcAsset(parts) {
	if (parts.length === 1) {
		return true;
	}
	if (parts[1] !== "x64") {
		return false;
	}
	return (
		parts.length === 2 ||
		parts[2] === "_manifest" ||
		/\.(exe|dll)$/.test(parts[2])
	);
}
