// 同梱バイナリで初期化と読み取り要求を検証する。モデル呼び出しや会話作成は行わない。
import { repoRoot, extensionRoot } from "../config/workspace-paths.cjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// 引数には展開済み VSIX の extension ディレクトリも指定できる。
const extensionPath = path.resolve(process.argv[2] ?? extensionRoot);
const cwd = path.resolve("dist/codex smoke workspace");
const outfile = path.resolve("dist/codex-smoke/client.mjs");
await mkdir(cwd, { recursive: true });
await build({
	stdin: {
		contents:
			'export { CodexClient } from "./apps/vscode-nerita/src/extension/backends/codex/CodexClient";',
		resolveDir: repoRoot,
		loader: "ts",
	},
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	outfile,
});
const { CodexClient } = await import(pathToFileURL(outfile).href);
let disconnected = false;
const client = await CodexClient.connect({
	extensionPath,
	cwd,
	clientInfo: {
		name: "vscode_codex",
		title: "VS Code Codex",
		version: "0.0.1",
	},
	callbacks: {
		disconnected: () => {
			disconnected = true;
		},
	},
});
try {
	assert.equal(client.serverInfo.platformOs, "windows");
	assert.deepEqual(await client.listLoadedThreads(), {
		data: [],
		nextCursor: null,
	});
} finally {
	await client.dispose();
}
assert.equal(disconnected, false);
console.log(
	"Codex: initialize → initialized → thread/loaded/list → dispose OK",
);
