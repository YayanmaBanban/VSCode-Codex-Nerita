// pnpm のリンク構造に依存しない実行資産を dist/runtime に配置する。
const fs = require("node:fs/promises");
const path = require("node:path");
const { createRequire } = require("node:module");

/** インストール済み adapter と現在の OS 用 Codex を実体として同梱する。 */
async function packageRuntime() {
	const target = path.resolve("dist/runtime");
	const adapter = require.resolve("@agentclientprotocol/codex-acp");
	const adapterRequire = createRequire(adapter);
	const codexJson = adapterRequire.resolve("@openai/codex/package.json");
	const codexRequire = createRequire(codexJson);
	const platformName = `@openai/codex-${process.platform}-${process.arch}`;
	const platformJson = codexRequire.resolve(`${platformName}/package.json`);
	await fs.mkdir(target, { recursive: true });
	await fs.copyFile(adapter, path.join(target, "adapter.mjs"));
	// 動的 require.resolve が参照する npm パッケージ構造を維持する。
	for (const [name, json] of [
		["@openai/codex", codexJson],
		[platformName, platformJson],
	]) {
		const root = path.dirname(json);
		const destination = path.join(target, "node_modules", name);
		await fs.mkdir(destination, { recursive: true });
		await fs.copyFile(json, path.join(destination, "package.json"));
		for (const entry of await fs.readdir(root, { withFileTypes: true })) {
			if (
				["bin", "vendor", "LICENSE", "README.md"].includes(entry.name)
			) {
				await fs.cp(
					path.join(root, entry.name),
					path.join(destination, entry.name),
					{ recursive: true, dereference: true },
				);
			}
		}
	}
	await fs.copyFile(
		path.resolve(path.dirname(adapter), "../LICENSE"),
		path.join(target, "ADAPTER-LICENSE"),
	);
	await fs.writeFile(
		path.join(target, "platform.json"),
		JSON.stringify({ platform: process.platform, arch: process.arch }),
	);
}
module.exports = { packageRuntime };
