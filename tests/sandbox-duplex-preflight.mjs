// Windows Sandbox の実接続で streaming command/exec を検査し、未対応の境界を成功扱いしない。
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { repoRoot, extensionRoot } from "../config/workspace-paths.cjs";

assert.equal(process.platform, "win32");
assert.equal(process.arch, "x64");
const out = path.join(extensionRoot, "dist/sandbox-duplex-preflight");
await mkdir(out, { recursive: true });
await build({
	stdin: {
		contents: [
			'export { CodexClient } from "./apps/vscode-nerita/src/extension/backends/codex/CodexClient";',
			'export { resolveWindowsSandbox } from "./apps/vscode-nerita/src/extension/backends/codex/CodexSandboxExecutor";',
			'export { toSandboxPolicy } from "./apps/vscode-nerita/src/extension/security/AgentAccessPolicy";',
			'export { trustedPolicy } from "./tests/fixtures/trustedPolicy";',
		].join("\n"),
		resolveDir: repoRoot,
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node22",
	outfile: path.join(out, "host.cjs"),
});
const host = createRequire(import.meta.url)(path.join(out, "host.cjs"));
const root = await realpath(
	await mkdtemp(path.join(tmpdir(), "nerita-duplex-preflight-")),
);
const lifetime = new AbortController();
const timer = setTimeout(() => lifetime.abort(), 20000);
let client;
let trust;
let processId;
try {
	const mode = await host.resolveWindowsSandbox(
		extensionRoot,
		root,
		lifetime.signal,
	);
	trust = await host.trustedPolicy([root], mode);
	client = await host.CodexClient.connect({
		extensionPath: extensionRoot,
		cwd: root,
		signal: lifetime.signal,
		windowsSandbox: mode,
		connectAbortOnly: true,
		clientInfo: { name: "nerita_duplex_preflight", version: "0.0.1" },
	});
	assert.equal((await client.readSandboxReadiness()).status, "ready");
	assert.equal((await client.readSandboxConfig(root)).sandbox, mode);
	const params = {
		command: [
			path.join(process.env.SystemRoot, "System32/cmd.exe"),
			"/d",
			"/c",
			"echo fixture-ready",
		],
		cwd: root,
		timeoutMs: 10000,
		sandboxPolicy: host.toSandboxPolicy(trust.policy),
	};
	const baseline = await client.executeCommand(params);
	assert.equal(baseline.exitCode, 0, baseline.stderr);
	processId = randomUUID();
	await client.executeCommand({
		...params,
		processId,
		streamStdin: true,
		streamStdoutStderr: true,
		outputBytesCap: 32768,
	});
	console.log(
		"streaming command/exec に対応しています。双方向往復・Stop の受入は別途必要です。",
	);
} catch (error) {
	if (
		error?.code === -32600 &&
		error.message ===
			"streaming command/exec is not supported with windows sandbox"
	) {
		console.error(
			"NOT READY: Windows Sandbox は streaming command/exec に未対応です。stdio MCP は有効化できません。",
		);
		process.exitCode = 1;
	} else {
		throw error;
	}
} finally {
	clearTimeout(timer);
	if (processId) {
		await client?.terminateCommand(processId).catch(() => undefined);
	}
	lifetime.abort();
	await client?.dispose();
	trust?.dispose();
	assert.equal(path.dirname(root), await realpath(tmpdir()));
	assert.ok(path.basename(root).startsWith("nerita-duplex-preflight-"));
	await rm(root, { recursive: true, force: true });
}
