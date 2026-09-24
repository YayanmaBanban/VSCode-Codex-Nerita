// 同梱App ServerのOS境界を、専用fixture内の無害な作成・削除だけで確認する。
import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readFile,
	writeFile,
	realpath,
	rm,
	access,
} from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const extensionPath = path.resolve(process.argv[2] ?? ".");
await mkdir("dist/sandbox-smoke", { recursive: true });
const output = path.resolve("dist/sandbox-smoke/executor.mjs");
await build({
	stdin: {
		contents: `export { createCodexSandboxExecutor } from "./src/extension/backends/codex/CodexSandboxExecutor"; export { createWorkspaceAccessPolicy } from "./src/extension/security/WorkspacePathPolicy"; export { issueApprovedToolCall } from "./src/extension/security/ApprovedToolCall"; export { resolvePowerShell } from "./src/extension/runtime/PowerShellExecutable";`,
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	outfile: output,
});
const {
	createCodexSandboxExecutor,
	createWorkspaceAccessPolicy,
	issueApprovedToolCall,
	resolvePowerShell,
} = await import(pathToFileURL(output).href);
const fixture = await realpath(
	await mkdtemp(path.resolve("dist/sandbox-smoke/run-")),
);
const root = path.join(fixture, "workspace with spaces");
const outside = path.join(fixture, "outside");
await Promise.all([mkdir(root), mkdir(outside)]);
const policy = await createWorkspaceAccessPolicy([root]);
const executor = createCodexSandboxExecutor(extensionPath);
const shell = await resolvePowerShell();
let networkConnections = 0;
const server = createServer((socket) => {
	networkConnections++;
	socket.end(
		"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
	);
});
/** PowerShell literal文字列を生成し、fixtureのパスに限定して操作する。 */
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
/** Windowsでは拒否を通常のexit codeではなくRPC errorで返す場合もある。 */
async function blocked(operation) {
	try {
		const result = await operation;
		assert.notEqual(result.exitCode, 0);
		return result;
	} catch (error) {
		assert.match(error.message, /sandbox denied exec error|timed out/i);
		return { exitCode: -1, stdout: "", stderr: error.message };
	}
}
/** smokeだけで発行する許可。モデル・認証・Human Approvalは使用しない。 */
function run(
	command,
	signal = new AbortController().signal,
	executable = shell,
	timeoutMs = 15000,
) {
	return executor.execute(
		issueApprovedToolCall(
			{
				tool: "sandbox-smoke",
				params: { command },
				command: [
					executable,
					"-NoLogo",
					"-NoProfile",
					"-NonInteractive",
					"-OutputFormat",
					"Text",
					"-EncodedCommand",
					Buffer.from(command, "utf16le").toString("base64"),
				],
				cwd: root,
				env: {},
				policy,
				timeoutMs,
			},
			signal,
		),
	);
}
try {
	const shells = [
		...new Set([
			shell,
			...(process.env.NERITA_SANDBOX_PWSH
				? [process.env.NERITA_SANDBOX_PWSH]
				: []),
			path.join(
				process.env.SystemRoot || "C:\\Windows",
				"System32/WindowsPowerShell/v1.0/powershell.exe",
			),
		]),
	];
	for (const executable of shells) {
		const result = await run(
			"Write-Output 'stdout'; Write-Error 'stderr'; exit 7",
			undefined,
			executable,
		);
		assert.equal(result.exitCode, 7, JSON.stringify(result));
		assert.match(result.stdout, /stdout/);
		assert.match(result.stderr, /stderr/);
		assert.equal(
			(
				await run(
					"Set-Content -LiteralPath inside.txt -Value ok",
					undefined,
					executable,
				)
			).exitCode,
			0,
		);
		assert.equal(
			(await readFile(path.join(root, "inside.txt"), "utf8")).trim(),
			"ok",
		);
	}
	const deniedWrite = await blocked(
		run(
			`$ErrorActionPreference='Stop'; Set-Content -LiteralPath ${quote(path.join(outside, "blocked.txt"))} -Value bad`,
		),
	);
	assert.notEqual(deniedWrite.exitCode, 0, JSON.stringify(deniedWrite));
	await assert.rejects(access(path.join(outside, "blocked.txt")));
	await writeFile(path.join(outside, "keep.txt"), "keep");
	const deniedDelete = await blocked(
		run(
			`$ErrorActionPreference='Stop'; Remove-Item -LiteralPath ${quote(path.join(outside, "keep.txt"))} -Force`,
		),
	);
	assert.notEqual(deniedDelete.exitCode, 0);
	assert.equal(
		await readFile(path.join(outside, "keep.txt"), "utf8"),
		"keep",
	);
	const changedCwd = await blocked(
		run(
			`$ErrorActionPreference='Stop'; Set-Location -LiteralPath ${quote(outside)}; Set-Content -LiteralPath escape.txt -Value bad`,
		),
	);
	assert.notEqual(changedCwd.exitCode, 0);
	await assert.rejects(access(path.join(outside, "escape.txt")));
	const native = path.join(
		process.env.SystemRoot || "C:\\Windows",
		"System32/cmd.exe",
	);
	const child = await blocked(
		run(
			`& ${quote(native)} /d /c ${quote(`echo bad > "${path.join(outside, "child.txt")}"`)}; exit $LASTEXITCODE`,
		),
	);
	assert.notEqual(child.exitCode, 0);
	await assert.rejects(access(path.join(outside, "child.txt")));
	const nativeResult = await executor.execute(
		issueApprovedToolCall(
			{
				tool: "native-smoke",
				params: {},
				command: [native, "/d", "/c", "echo native"],
				cwd: root,
				env: {},
				policy,
				timeoutMs: 15000,
			},
			new AbortController().signal,
		),
	);
	assert.equal(nativeResult.exitCode, 0);
	assert.match(nativeResult.stdout, /native/);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.equal(
		await (await fetch(`http://127.0.0.1:${address.port}`)).text(),
		"ok",
	);
	networkConnections = 0;
	const network = await blocked(
		run(
			`& ${quote(path.join(process.env.SystemRoot || "C:\\Windows", "System32/curl.exe"))} --noproxy '*' --connect-timeout 3 --max-time 3 http://127.0.0.1:${address.port}; exit $LASTEXITCODE`,
		),
	);
	assert.notEqual(
		network.exitCode,
		0,
		"networkAccess=false must block direct sockets",
	);
	assert.equal(
		networkConnections,
		0,
		"Sandbox process reached the host network listener",
	);
	const cancel = new AbortController();
	const running = run(
		`& ${quote(path.join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"))} -NoProfile -Command "Set-Content -LiteralPath started.txt -Value started; Start-Sleep -Seconds 8; Set-Content -LiteralPath after-stop.txt -Value bad"`,
		cancel.signal,
	);
	const rejected = assert.rejects(running);
	const startedAt = Date.now();
	try {
		while (
			!(await readFile(path.join(root, "started.txt"), "utf8").catch(
				() => "",
			))
		) {
			assert.ok(
				Date.now() - startedAt < 10000,
				"child process did not start",
			);
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	} finally {
		cancel.abort();
	}
	await rejected;
	await assert.rejects(access(path.join(root, "after-stop.txt")));
	const timeout = await blocked(
		run(
			"Start-Sleep -Seconds 8; Set-Content -LiteralPath after-timeout.txt -Value bad",
			undefined,
			shell,
			1000,
		),
	);
	assert.notEqual(timeout.exitCode, 0);
	// 親だけ終了して子が残った場合を検出するため、遅延書込みの期限を越えて確認する。
	await new Promise((resolve) => setTimeout(resolve, 9000));
	await assert.rejects(access(path.join(root, "after-stop.txt")));
	await assert.rejects(access(path.join(root, "after-timeout.txt")));
	console.log(
		"PASS: Windows PowerShell / pwsh / native; workspace boundary; child / cwd escape; network deny; stdout / stderr / exit; abort / timeout",
	);
} finally {
	server.close();
	assert.equal(path.dirname(fixture), path.resolve("dist/sandbox-smoke"));
	assert.ok(path.basename(fixture).startsWith("run-"));
	await rm(fixture, { recursive: true, force: true });
}
