// 直接依存の Codex で安定版の通信型を生成し、生成元のバージョンを記録する。
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const codexJson = require.resolve("@openai/codex/package.json");
const { version } = require(codexJson);
if (require("../package.json").dependencies["@openai/codex"] !== version) {
	throw new Error(
		"直接依存の Codex を完全固定し、pnpm install を実行してください。",
	);
}
const out = path.join(root, "src/codex-app-server");
const result = spawnSync(
	process.execPath,
	[
		path.join(path.dirname(codexJson), "bin/codex.js"),
		"app-server",
		"generate-ts",
		"--out",
		out,
	],
	{ cwd: root, stdio: "inherit", windowsHide: true },
);
if (result.error) {
	throw result.error;
}
if (result.status !== 0) {
	process.exit(result.status ?? 1);
}
fs.writeFileSync(
	path.join(out, "version.json"),
	`${JSON.stringify({ version, experimental: false }, null, 2)}\n`,
);
