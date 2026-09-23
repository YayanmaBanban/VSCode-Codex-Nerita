// 更新先のライセンスを確認した後、同じ製品の不要な版だけを削除する。
const fs = require("node:fs/promises");
const path = require("node:path");

/** リンク先や他製品を削除せず、現在版だけを残す。 */
async function cleanupLicenses(directory, product, version) {
	if (
		!["codex", "pi"].includes(product) ||
		!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)
	) {
		throw new Error("ライセンス削除対象の製品またはバージョンが不正です。");
	}
	const root = path.resolve(directory);
	if ((await fs.realpath(root)) !== root) {
		throw new Error("ライセンスの保存先にリンクは使用できません。");
	}
	const current = `${product}-${version}`;
	await verifyCurrentLicenses(product, root, current);
	const pattern = new RegExp(
		`^${product}-\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$`,
	);
	for (const entry of await fs.readdir(root, { withFileTypes: true })) {
		if (
			!entry.isDirectory() ||
			entry.name === current ||
			!pattern.test(entry.name)
		) {
			continue;
		}
		await removeOldLicense(root, entry);
	}
}

module.exports = { cleanupLicenses };

/** 削除対象が保存先直下の実ディレクトリであることを確認する。 */
async function removeOldLicense(root, entry) {
	const target = path.join(root, entry.name);
	if (
		path.dirname(target) !== root ||
		(await fs.realpath(target)) !== target ||
		(await fs.lstat(target)).isSymbolicLink()
	) {
		throw new Error(`ライセンス削除先の安全確認に失敗しました: ${target}`);
	}
	await fs.rm(target, { recursive: true });
}

/** 削除前に現在版のライセンス実体を確認する。 */
async function verifyCurrentLicenses(product, root, current) {
	for (const name of product === "codex"
		? ["LICENSE", "NOTICE"]
		: ["LICENSE"]) {
		const file = path.join(root, current, name);
		if (
			(await fs.realpath(file)) !== file ||
			!(await fs.stat(file)).isFile() ||
			(await fs.readFile(file)).length === 0
		) {
			throw new Error(`更新先のライセンスを確認できません: ${file}`);
		}
	}
}
