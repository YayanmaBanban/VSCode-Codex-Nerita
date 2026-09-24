// 隔離したCODEX_HOMEで設定優先順位を実バイナリに照合する。モデルやShellは実行しない。
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = await mkdtemp(path.resolve("dist/sandbox-config-"));
const cwd = path.join(root, "workspace");
const home = path.join(root, "home");
await mkdir(path.join(cwd, ".codex"), { recursive: true });
await mkdir(path.join(cwd, ".git"), { recursive: true });
await mkdir(home);
const outfile = path.join(root, "client.mjs");
await build({
	stdin: {
		contents:
			'export { CodexClient } from "./src/extension/backends/codex/CodexClient";',
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	outfile,
});
const { CodexClient } = await import(pathToFileURL(outfile).href);
process.env.CODEX_HOME = home;
const trust = `[projects.${JSON.stringify(cwd)}]\ntrust_level = "trusted"\n`;
for (const [name, global, project, expected] of [
	["vscode fallback", "", "", "unelevated"],
	["global wins", '[windows]\nsandbox = "elevated"\n', "", "elevated"],
	[
		"workspace wins",
		'[windows]\nsandbox = "elevated"\n',
		'[windows]\nsandbox = "unelevated"\n',
		"unelevated",
	],
]) {
	await writeFile(path.join(home, "config.toml"), global + trust);
	await writeFile(path.join(cwd, ".codex", "config.toml"), project);
	let disconnected = false;
	const client = await CodexClient.connect({
		extensionPath: process.cwd(),
		cwd,
		windowsSandbox: "unelevated",
		clientInfo: { name: "nerita_sandbox_config_test", version: "0.0.1" },
		callbacks: {
			disconnected: () => {
				disconnected = true;
			},
		},
	});
	try {
		// bundle後のprivate transportへ読み取りだけを送り、実際の起動設定を照合する。
		assert.deepEqual(
			await client.transport.request("config/read", { cwd }),
			{ sandbox: expected },
		);
	} finally {
		await client.dispose();
	}
	assert.equal(disconnected, false);
	console.log(`${name}: ${expected} OK`);
}
