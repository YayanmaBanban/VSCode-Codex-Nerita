// インストール済みの実行依存を辿り、リンクを使わない node_modules を組み立てる。
const fs = require("node:fs/promises");
const path = require("node:path");
const { createRequire } = require("node:module");

/** exports で package.json を非公開にしたパッケージも、Node の探索順で見つける。 */
async function resolvePackage(name, parent) {
	const locations = createRequire(
		path.join(parent, "package.json"),
	).resolve.paths(name);
	for (const location of locations ?? []) {
		const candidate = path.join(location, name);
		try {
			await fs.access(path.join(candidate, "package.json"));
			return await fs.realpath(candidate);
		} catch (error) {
			if (error.code !== "ENOENT" && error.code !== "ENOTDIR") {
				throw error;
			}
		}
	}
	return undefined;
}

/** 任意依存の OS・CPU 制約を現在のビルド環境に照合する。 */
function supportsPlatform(manifest) {
	return [
		[manifest.os, process.platform],
		[manifest.cpu, process.arch],
	].every(
		([allowed, current]) =>
			!allowed ||
			(!allowed.includes(`!${current}`) &&
				(!allowed.some((value) => !value.startsWith("!")) ||
					allowed.includes(current))),
	);
}

/** `devDependencies` を除き、必須依存の不足は梱包時点でエラーにする。 */
async function collectPackages(source, packages) {
	if (packages.has(source)) {
		return;
	}
	const manifest = JSON.parse(
		await fs.readFile(path.join(source, "package.json"), "utf8"),
	);
	const dependencies = new Map();
	packages.set(source, { manifest, dependencies });
	const names = new Set([
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest.optionalDependencies ?? {}),
		...Object.keys(manifest.peerDependencies ?? {}),
	]);
	for (const name of names) {
		const optional = isOptionalDependency(manifest, name);
		const dependency = await resolvePackage(name, source);
		if (!dependency) {
			if (optional) {
				continue;
			}
			throw new Error(
				`${manifest.name}: 実行依存 ${name} が見つかりません。`,
			);
		}
		const dependencyManifest = JSON.parse(
			await fs.readFile(path.join(dependency, "package.json"), "utf8"),
		);
		if (!supportsPlatform(dependencyManifest)) {
			if (optional) {
				continue;
			}
			throw new Error(
				`${name}: ${process.platform}/${process.arch} に対応していません。`,
			);
		}
		dependencies.set(name, dependency);
		await collectPackages(dependency, packages);
	}
}

/** 通常依存を優先して任意依存かどうか判定する。 */
function isOptionalDependency(manifest, name) {
	return (
		Object.hasOwn(manifest.optionalDependencies ?? {}, name) ||
		(!Object.hasOwn(manifest.dependencies ?? {}, name) &&
			manifest.peerDependenciesMeta?.[name]?.optional === true)
	);
}

/** 相対資産を保ち、競合するバージョンだけ利用側の node_modules へ配置する。 */
async function copyPackage(source, destination, packages, inherited) {
	await fs.cp(source, destination, {
		recursive: true,
		dereference: true,
		filter: (file) => path.basename(file) !== "node_modules",
	});
	const local = new Map();
	for (const [name, dependency] of packages.get(source).dependencies) {
		if (inherited.get(name) !== dependency) {
			local.set(name, dependency);
		}
	}
	// 兄弟依存を先に確定し、後から追加した別バージョンで子孫の解決先が変わるのを防ぐ。
	const visible = new Map([...inherited, ...local]);
	for (const [name, dependency] of local) {
		await copyPackage(
			dependency,
			path.join(destination, "node_modules", name),
			packages,
			visible,
		);
	}
}

/** 固定済み依存グラフを、pnpm や開発ツリーから独立した配布先へコピーする。 */
async function copyRuntimePackage(source, target) {
	source = await fs.realpath(source);
	const packages = new Map();
	await collectPackages(source, packages);
	const roots = new Map([[packages.get(source).manifest.name, source]]);
	for (const { dependencies } of packages.values()) {
		for (const [name, dependency] of dependencies) {
			if (!roots.has(name)) {
				roots.set(name, dependency);
			}
		}
	}
	for (const [name, dependency] of roots) {
		await copyPackage(
			dependency,
			path.join(target, "node_modules", name),
			packages,
			roots,
		);
	}
}

module.exports = { copyRuntimePackage };
