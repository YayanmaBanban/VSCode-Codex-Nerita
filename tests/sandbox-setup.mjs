// 明示的に起動された場合だけWindows Sandboxの管理者セットアップを要求する。
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const cwd = process.cwd();
await mkdir("dist/sandbox-smoke", { recursive: true });
const outfile = path.resolve("dist/sandbox-smoke/setup-client.mjs");
await build({
	stdin: {
		contents:
			'export { CodexClient } from "./src/extension/backends/codex/CodexClient";',
		resolveDir: cwd,
		loader: "ts",
	},
	outfile,
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
});
const { CodexClient } = await import(pathToFileURL(outfile).href);
let finish;
const completed = new Promise((resolve) => {
	finish = resolve;
});
const client = await CodexClient.connect({
	extensionPath: cwd,
	cwd,
	forceWindowsSandbox: true,
	clientInfo: {
		name: "nerita_sandbox_setup",
		title: "Nerita Sandbox setup",
		version: "0.0.1",
	},
	callbacks: {
		notification(message) {
			if (message.method === "windowsSandbox/setupCompleted") {
				finish(message.params);
			}
		},
	},
});
try {
	console.log("Readiness:", await client.readSandboxReadiness());
	console.log("Setup requested:", await client.setupWindowsSandbox(cwd));
	const timer = setTimeout(
		() =>
			finish({
				success: false,
				error: "Setup timed out after 5 minutes",
			}),
		300000,
	);
	const result = await completed;
	clearTimeout(timer);
	console.log("Setup completed:", result);
	console.log("Readiness:", await client.readSandboxReadiness());
	if (!result?.success) {
		process.exitCode = 1;
	}
} finally {
	await client.dispose();
}
