// 作業ディレクトリに依存せず、リポジトリと拡張機能の配置を区別する。
const path = require("node:path");
const { createRequire } = require("node:module");

const repoRoot = path.resolve(__dirname, "..");
const extensionRoot = path.join(repoRoot, "apps", "vscode-nerita");
const extensionRequire = createRequire(
	path.join(extensionRoot, "package.json"),
);

module.exports = { repoRoot, extensionRoot, extensionRequire };
