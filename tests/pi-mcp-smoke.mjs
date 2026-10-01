// 本番 Host の検証入口を組み立て、開発用または展開した VSIX の資産だけで実行する。
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { extensionRoot } from "../config/workspace-paths.cjs";
import { vscodeBoundary } from "./fixtures/vscodeBoundary.mjs";

const extensionPath = resolve(process.argv[2] ?? extensionRoot);
const output = resolve("dist/pi-mcp-verification");
await mkdir(output, { recursive: true });
await build({
	entryPoints: ["tests/piMcpSmoke.ts", "tests/piMcpAcceptance.ts"],
	outdir: output,
	outExtension: { ".js": ".mjs" },
	bundle: true,
	platform: "node",
	format: "esm",
	conditions: ["nerita-source"],
	plugins: [vscodeBoundary],
	logLevel: "silent",
});
const smoke = await import(pathToFileURL(join(output, "piMcpSmoke.mjs")).href);
await smoke.piMcpSmoke(extensionPath);
console.log(
	"PASS: Runtime / Controller HTTP MCP / codemode / 承認・拒否・Stop / 保存前の結果変換",
);
if (process.env.NERITA_MCP_HTTP_URL) {
	const acceptance = await import(
		pathToFileURL(join(output, "piMcpAcceptance.mjs")).href
	);
	await acceptance.piMcpAcceptance(
		extensionPath,
		process.env.NERITA_MCP_HTTP_URL,
		process.env.NERITA_MCP_HTTP_TOKEN,
	);
}
