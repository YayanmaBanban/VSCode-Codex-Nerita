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
// 診断用の固定fixtureだけを動かす。製品の通信検査を解除する設定は追加しない。
const filesystemOnly = process.argv.includes("--filesystem-only");
await mkdir("dist/sandbox-smoke", { recursive: true });
const output = path.resolve("dist/sandbox-smoke/executor.mjs");
await build({
	stdin: {
		contents: `export { createCodexSandboxExecutor, CodexSandboxExecutor } from "./src/extension/backends/codex/CodexSandboxExecutor"; export { CodexClient } from "./src/extension/backends/codex/CodexClient"; export { createWorkspaceAccessPolicy } from "./src/extension/security/WorkspacePathPolicy"; export { issueApprovedToolCall } from "./src/extension/security/ApprovedToolCall"; export { resolvePowerShell } from "./src/extension/runtime/PowerShellExecutable";`,
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
	CodexSandboxExecutor,
	CodexClient,
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
const productionExecutor = createCodexSandboxExecutor(extensionPath);
const executor = filesystemOnly
	? new CodexSandboxExecutor(
			(cwd, signal) =>
				CodexClient.connect({
					extensionPath,
					cwd,
					signal,
					forceWindowsSandbox: true,
					windowsSandbox: "elevated",
					clientInfo: {
						name: "nerita_filesystem_smoke",
						version: "0.0.1",
					},
				}),
			process.platform,
			async () => {},
		)
	: productionExecutor;
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
	let result;
	try {
		result = await operation;
	} catch (error) {
		assert.match(error.message, /sandbox denied exec error|timed out/i);
		return { exitCode: -1, stdout: "", stderr: error.message };
	}
	assert.notEqual(result.exitCode, 0, JSON.stringify(result));
	return result;
}
/** smokeだけで発行する許可。モデル・認証・Human Approvalは使用しない。 */
function run(
	command,
	signal = new AbortController().signal,
	executable = shell,
	timeoutMs = 15000,
	selectedExecutor = executor,
	selectedPolicy = policy,
) {
	return selectedExecutor.execute(
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
					"-Command",
					command,
				],
				cwd: root,
				env: {},
				policy: selectedPolicy,
				timeoutMs,
			},
			signal,
		),
	);
}
try {
	if (filesystemOnly) {
		await assert.rejects(
			run(
				"Set-Content -LiteralPath must-not-execute.txt -Value bad",
				undefined,
				shell,
				15000,
				productionExecutor,
			),
			/通信隔離/,
		);
		await assert.rejects(access(path.join(root, "must-not-execute.txt")));
		console.log(
			"PASS: production network=false rejects before the requested command; subsequent checks isolate filesystem/process behavior with networkAccess=false",
		);
	}
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
		// -Commandの一引数に含む改行・引用符・変数記号・日本語を実RPC経由で確認する。
		const literal = `日本語 "引用" 'single' $literal \\path with spaces\\`;
		const quoted = await run(
			`[Console]::OutputEncoding=[Text.Encoding]::UTF8\n$text = @'\n${literal}\n'@\nWrite-Output $text\nexit 23`,
			undefined,
			executable,
		);
		assert.equal(quoted.exitCode, 23, JSON.stringify(quoted));
		assert.equal(quoted.stdout.trim(), literal);
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
	const readOutside = await run(
		`Get-Content -LiteralPath ${quote(path.join(outside, "keep.txt"))}`,
	);
	assert.equal(readOutside.exitCode, 0);
	assert.match(readOutside.stdout, /keep/);
	const readOnly = {
		...policy,
		filesystem: { ...policy.filesystem, writableRoots: [] },
	};
	assert.equal(
		(
			await run(
				"Get-Content -LiteralPath inside.txt",
				undefined,
				shell,
				15000,
				executor,
				readOnly,
			)
		).exitCode,
		0,
	);
	await blocked(
		run(
			"$ErrorActionPreference='Stop'; Set-Content -LiteralPath readonly-denied.txt -Value bad",
			undefined,
			shell,
			15000,
			executor,
			readOnly,
		),
	);
	await assert.rejects(access(path.join(root, "readonly-denied.txt")));
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
	// parent → child → grandchildの実プロセスで、孫にも同じwrite/delete境界が届くことを確認する。
	const grandchildWrite = nested(
		`$ErrorActionPreference='Stop'; Set-Content -LiteralPath ${quote(path.join(outside, "grandchild.txt"))} -Value bad`,
		2,
	);
	await blocked(run(grandchildWrite));
	await assert.rejects(access(path.join(outside, "grandchild.txt")));
	await blocked(
		run(
			nested(
				`$ErrorActionPreference='Stop'; Remove-Item -LiteralPath ${quote(path.join(outside, "keep.txt"))} -Force`,
				2,
			),
		),
	);
	assert.equal(
		await readFile(path.join(outside, "keep.txt"), "utf8"),
		"keep",
	);
	const grandchildRead = await run(
		nested(
			`Get-Content -LiteralPath ${quote(path.join(outside, "keep.txt"))}`,
			2,
		),
	);
	assert.equal(grandchildRead.exitCode, 0);
	assert.match(grandchildRead.stdout, /keep/);
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
	if (!filesystemOnly) {
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
	}
	const cancel = new AbortController();
	const running = run(
		nested(
			"Set-Content -LiteralPath started.txt -Value started; Start-Sleep -Seconds 8; Set-Content -LiteralPath after-stop.txt -Value bad",
			2,
		),
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
			nested(
				"Set-Content -LiteralPath timeout-started.txt -Value started; Start-Sleep -Seconds 8; Set-Content -LiteralPath after-timeout.txt -Value bad",
				2,
			),
			undefined,
			shell,
			4000,
		),
	);
	assert.notEqual(timeout.exitCode, 0);
	assert.match(
		await readFile(path.join(root, "timeout-started.txt"), "utf8"),
		/started/,
	);
	// 親だけ終了して子が残った場合を検出するため、遅延書込みの期限を越えて確認する。
	await new Promise((resolve) => setTimeout(resolve, 9000));
	await assert.rejects(access(path.join(root, "after-stop.txt")));
	await assert.rejects(access(path.join(root, "after-timeout.txt")));
	console.log(
		`PASS: ${shells.map((executable) => path.basename(executable)).join(" / ")} / native; outside read allowed; outside write/delete denied; readOnly; child/grandchild / cwd escape; stdout / stderr / exit; abort / timeout; network isolation ${filesystemOnly ? "NOT VERIFIED (diagnostic only)" : "verified"}`,
	);
} finally {
	server.close();
	assert.equal(path.dirname(fixture), path.resolve("dist/sandbox-smoke"));
	assert.ok(path.basename(fixture).startsWith("run-"));
	await rm(fixture, { recursive: true, force: true });
}

/** 階層ごとの終了コードを親まで伝播し、起動失敗を境界成功と数えない。 */
function nested(command, depth) {
	let source = command;
	for (let index = 0; index < depth; index++) {
		// ScriptBlockではなく文字列を渡し、PowerShellによる暗黙のEncodedCommand変換も避ける。
		source = `& ${quote(shell)} -NoLogo -NoProfile -NonInteractive -Command ${quote(source)}; exit $LASTEXITCODE`;
	}
	return source;
}
