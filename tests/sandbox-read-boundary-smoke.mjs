// 同梱Windows Sandboxが有限の読取りrootを拒否することを実機で検証する。
// 拒否の検証成功はShellの実行成功やOS読取り隔離の達成を意味しない。
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { sandboxProfileClient } from "./sandbox-profile-client.mjs";

const extensionPath = path.resolve(process.argv[2] ?? ".");
const outputRoot = path.resolve("dist/sandbox-read-boundary");
await mkdir(outputRoot, { recursive: true });
const outfile = path.join(outputRoot, "runtime.mjs");
await build({
	stdin: {
		contents:
			'export { resolveCodexExecutable } from "./src/extension/backends/codex/runtime/executable"; export { stopAppServerProcess } from "./src/extension/backends/codex/runtime/AppServerProcess";',
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	outfile,
});
const { resolveCodexExecutable, stopAppServerProcess } = await import(
	pathToFileURL(outfile).href
);
const executable = await resolveCodexExecutable(extensionPath);
const fixture = await realpath(await mkdtemp(path.join(outputRoot, "run-")));
const workspace = path.join(fixture, "workspace with spaces");
const outside = path.join(fixture, "outside.txt");
const results = [];
try {
	await mkdir(workspace);
	await writeFile(path.join(workspace, "inside.txt"), "INSIDE_FIXTURE");
	await writeFile(outside, "OUTSIDE_FIXTURE");
	const { stdout } = await promisify(execFile)(executable, ["--version"], {
		windowsHide: true,
		timeout: 10000,
	});
	for (const mode of ["elevated", "unelevated"]) {
		const configHome = path.join(fixture, mode);
		await mkdir(configHome);
		await writeFile(
			path.join(configHome, "config.toml"),
			profileConfig(mode, workspace),
		);
		const client = sandboxProfileClient(
			executable,
			workspace,
			configHome,
			stopAppServerProcess,
		);
		try {
			await client.request("initialize", {
				clientInfo: {
					name: "nerita_read_boundary_test",
					version: "0.0.1",
				},
				capabilities: { experimentalApi: true },
			});
			client.initialized();
			results.push(
				...(await checkProfiles(client, mode, workspace, outside)),
			);
		} finally {
			await client.dispose();
		}
	}
	await assert.rejects(readFile(path.join(workspace, "executed.txt")), {
		code: "ENOENT",
	});
	assert.equal(await readFile(outside, "utf8"), "OUTSIDE_FIXTURE");
	const report = {
		checkedAt: new Date().toISOString(),
		version: stdout.trim(),
		shellAvailable: false,
		osReadIsolationVerified: false,
		results,
	};
	await writeFile(
		path.join(outputRoot, "result.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	console.log(
		`${report.version}: strict Shell UNAVAILABLE; both Windows modes reject restricted reads before execution (${results.length} cases).`,
	);
	console.log(
		"PASS: unsupported-profile rejection only; Shell execution/OS isolation remain unverified.",
	);
} finally {
	assert.equal(path.dirname(fixture), await realpath(outputRoot));
	assert.ok(path.basename(fixture).startsWith("run-"));
	await rm(fixture, { recursive: true, force: true });
}

/** profile登録成功を実行可能と誤認せず、各profileのOS側エラーまで確認する。 */
async function checkProfiles(client, mode, workspace, outside) {
	const profiles = await client.request("permissionProfile/list", {
		cwd: workspace,
	});
	const results = [];
	for (const id of ["strict", "root-deny"]) {
		assert.ok(
			profiles.data.some(
				(profile) => profile.id === id && profile.allowed,
			),
			"fixture profile was not accepted",
		);
		results.push(
			await rejectedCommand(client, mode, id, workspace, outside),
		);
	}
	return results;
}

/** 読取り範囲のないlegacy sandbox設定と混在させず、workspaceだけを許可する。 */
function profileConfig(mode, workspace) {
	return `default_permissions = "strict"
[windows]
sandbox = "${mode}"
[permissions.strict.filesystem]
${JSON.stringify(workspace)} = "write"
[permissions.strict.network]
enabled = false
[permissions.root-deny.filesystem]
":root" = "deny"
${JSON.stringify(workspace)} = "write"
[permissions.root-deny.network]
enabled = false
`;
}

/** 初期化失敗やtimeoutでは代替せず、OS実装が示す未対応理由を照合する。 */
async function rejectedCommand(client, mode, profile, workspace, outside) {
	const shell = path.join(
		process.env.SystemRoot || "C:\\Windows",
		"System32/WindowsPowerShell/v1.0/powershell.exe",
	);
	const script = `$ErrorActionPreference='Stop'; Set-Content -LiteralPath executed.txt -Value executed; Get-Content -LiteralPath inside.txt; Get-Content -LiteralPath '${outside.replaceAll("'", "''")}'`;
	let reason;
	await assert.rejects(
		client.request("command/exec", {
			command: [
				shell,
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				script,
			],
			cwd: workspace,
			permissionProfile: profile,
			timeoutMs: 4000,
		}),
		(error) => {
			assert.equal(error.code, -32603);
			assert.match(
				error.message,
				mode === "elevated"
					? /elevated Windows sandbox requires effective `:root` read access/
					: /restricted-token sandbox cannot enforce split filesystem read restrictions.*refusing to run unsandboxed/,
			);
			reason = error.message;
			return true;
		},
	);
	return { mode, profile, status: "unsupported", reason };
}
