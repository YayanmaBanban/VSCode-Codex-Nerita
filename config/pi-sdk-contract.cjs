// SDK 内部へのバンドル互換処理は、確認済みソースにだけ適用する。
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const contract = require("./pi-sdk-contract.json");

/** SDK 更新時は差分を確認してから、記録したソースのハッシュと配布テストを更新する。 */
async function verifyPiSources(roots) {
	for (const [name, files] of Object.entries(contract)) {
		for (const [file, expected] of Object.entries(files)) {
			const source = await fs.readFile(path.join(roots[name], file));
			const actual = createHash("sha256").update(source).digest("hex");
			if (actual !== expected) {
				throw new Error(
					`Pi SDKのbundle契約が変更されています: ${name}/${file}。互換処理とtest:runtimeを確認してください。`,
				);
			}
		}
	}
}
module.exports = { verifyPiSources };
