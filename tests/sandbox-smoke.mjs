// 本番Executorを使うWindows受入。通信の到達を実行委譲の成功と混同せず、個別結果を記録する。
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import {
	mkdir,
	mkdtemp,
	realpath,
	readFile,
	writeFile,
	rm,
	symlink,
} from "node:fs/promises";
import { tmpdir, release } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

assert.equal(process.platform, "win32", "Windows x64実機専用");
assert.equal(process.arch, "x64");
const extensionPath = process.cwd();
const out = path.join(extensionPath, "dist/sandbox-smoke");
await mkdir(out, { recursive: true });
await build({
	stdin: {
		contents: [
			'export { CodexClient } from "./src/extension/backends/codex/CodexClient";',
			'export { createCodexSandboxExecutor, resolveWindowsSandbox } from "./src/extension/backends/codex/CodexSandboxExecutor";',
			'export { approveToolCall } from "./src/extension/security/ApprovalGuard";',
			'export { createWorkspaceAccessPolicy, WorkspacePathPolicy } from "./src/extension/security/WorkspacePathPolicy";',
			'export { createPiSandboxPowerShellTool } from "./src/extension/backends/pi/PiPowerShellTool";',
			'export { toSandboxPolicy } from "./src/extension/security/AgentAccessPolicy";',
			'export { commandEnvironment } from "./src/extension/runtime/CommandEnvironment";',
			'export { resolvePowerShell } from "./src/extension/runtime/PowerShellExecutable";',
		].join("\n"),
		resolveDir: extensionPath,
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node22",
	outfile: path.join(out, "host.cjs"),
});
const host = createRequire(import.meta.url)(path.join(out, "host.cjs"));
const sdk = await import(
	pathToFileURL(path.join(extensionPath, "dist/runtime/pi.mjs")).href
);
const root = await realpath(
	await mkdtemp(path.join(tmpdir(), "nerita-sandbox-smoke-")),
);
const cwd = path.join(root, "workspace");
const outside = path.join(root, "outside");
const second = path.join(root, "second");
await Promise.all([mkdir(cwd), mkdir(outside), mkdir(second)]);
const lifetime = new AbortController();
const mode = await host.resolveWindowsSandbox(
	extensionPath,
	cwd,
	lifetime.signal,
);
const policy = await host.createWorkspaceAccessPolicy([cwd], mode);
const executor = host.createCodexSandboxExecutor(extensionPath);
const pwsh = process.env.NERITA_SANDBOX_PWSH
	? await realpath(process.env.NERITA_SANDBOX_PWSH)
	: await host
			.resolvePowerShell("pwsh")
			.catch(() => host.resolvePowerShell());
const windowsShell = path.join(
	process.env.SystemRoot,
	"System32/WindowsPowerShell/v1.0/powershell.exe",
);
const project = JSON.parse(
	await readFile(path.join(extensionPath, "package.json"), "utf8"),
);
const report = {
	date: new Date().toISOString(),
	commit: execFileSync("git", ["rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim(),
	workingTree: "implementation changes",
	codex: project.dependencies["@openai/codex"],
	pi: project.dependencies["@earendil-works/pi-coding-agent"],
	windows: release(),
	node: process.version,
	mode,
	executables: { windowsShell, pwsh, native: process.execPath },
	policy: host.toSandboxPolicy(policy),
	fixture: root,
	cases: [],
};
const servers = [];
let failed = false;

/** 専用fixtureのみに触れる受入結果を、失敗後も続けて記録する。 */
async function test(id, operation) {
	try {
		const details = await operation();
		report.cases.push({ id, status: "pass", details });
		console.log(`PASS ${id}`);
	} catch (error) {
		failed = true;
		report.cases.push({
			id,
			status: error.message.startsWith("未検証:") ? "unverified" : "fail",
			error: error.message,
		});
		console.log(`FAIL ${id}: ${error.message}`);
	}
}

/** 承認と同じargv/policyを本番Executorへ渡す。 */
async function execute(command, options = {}) {
	const signal = options.signal ?? lifetime.signal;
	const call = {
		tool: "powershell",
		params: { command },
		command,
		cwd: options.cwd ?? cwd,
		policy: options.policy ?? policy,
		env: host.commandEnvironment(),
		timeoutMs: options.timeoutMs ?? 15_000,
	};
	const permit = await host.approveToolCall(
		call,
		() => Promise.resolve(signal),
		signal,
	);
	return executor.execute(permit);
}

/** 実SDKのTool定義と製品adapterを使い、RPC要求・結果は実Executorを通過した値だけを観測する。 */
async function executePiPowerShell(command, executable = pwsh) {
	let call;
	let result;
	const name =
		path.basename(executable).toLowerCase() === "pwsh.exe"
			? "pwsh"
			: "powershell";
	const tool = host.createPiSandboxPowerShellTool(
		{ ...sdk.createPowerShellToolDefinition(cwd), name },
		new host.WorkspacePathPolicy(policy, cwd),
		(_title, signal) => Promise.resolve(signal),
		{
			describe: executor.describe?.bind(executor),
			async execute(approved) {
				call = approved.call;
				result = await executor.execute(approved);
				return result;
			},
		},
		lifetime.signal,
		{ name, executable: await realpath(executable) },
	);
	const toolResult = await tool.execute(
		"sandbox-comparison",
		{ command, timeout: 10 },
		lifetime.signal,
	);
	assert.ok(call && result);
	assert.equal(toolResult.details.exitCode, result.exitCode);
	return { call, result, toolResult };
}

/** ScriptBlock・EncodedCommand・ExecutionPolicy変更を使わない。 */
function shellArgs(executable, text) {
	return [
		executable,
		"-NoLogo",
		"-NoProfile",
		"-NonInteractive",
		"-Command",
		`try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\n${text}`,
	];
}

/** 本版は書込み拒否をcommand結果ではなくRPCエラーで返す場合もある。 */
async function deniedWrite(command, options) {
	let result;
	try {
		result = await execute(command, options);
	} catch (error) {
		assert.match(error.message, /sandbox denied exec/);
		assert.match(
			error.message,
			/PermissionDenied|UnauthorizedAccess|EPERM|EACCES|Access to the path .* is denied/,
		);
		return { rpcDenied: true, message: error.message };
	}
	assert.notEqual(result.exitCode, 0, "拒否対象の書込みが成功した");
	assert.match(
		result.stderr,
		/PermissionDenied|UnauthorizedAccess|EPERM|EACCES|Access to the path .* is denied/,
	);
	return result;
}

/** PowerShellの単一引用文字列としてfixture pathだけを引用する。 */
const quote = (value) => `'${value.replaceAll("'", "''")}'`;

/** 確定したプロセス開始マーカーを期限付きで待つ。 */
async function until(check, timeout = 15_000) {
	const deadline = Date.now() + timeout;
	while (!(await check())) {
		assert.ok(Date.now() < deadline, "fixture marker timeout");
		await new Promise((resolve) => setTimeout(resolve, 40));
	}
}

try {
	for (const [name, command] of [
		[
			"Windows PowerShell",
			shellArgs(
				windowsShell,
				"Write-Output '正常 日本語 $literal'; Write-Error 'nerita-stderr'; exit 7",
			),
		],
		...(path.basename(pwsh).toLowerCase() === "pwsh.exe"
			? [
					[
						"pwsh",
						shellArgs(
							pwsh,
							"Write-Output '正常 日本語 $literal'; Write-Error 'nerita-stderr'; exit 7",
						),
					],
				]
			: []),
		[
			"native node",
			[
				process.execPath,
				"-e",
				"console.log('正常 日本語 $literal'); console.error('stderr'); process.exit(7)",
			],
		],
	]) {
		await test(`W01/W04-output ${name}`, async () => {
			const result = await execute(command);
			assert.equal(result.exitCode, 7);
			assert.match(result.stdout, /正常 日本語 \$literal/);
			assert.match(result.stderr, /stderr/);
			assert.doesNotMatch(
				result.stderr,
				/PropertySetterNotSupported|MethodInvocationNotSupported/,
			);
			return result;
		});
	}
	if (path.basename(pwsh).toLowerCase() !== "pwsh.exe") {
		report.cases.push({
			id: "W01 pwsh",
			status: "skip",
			reason: "通常配置のpwshがなく、検出されたMSIX版はSandboxユーザーから利用できないためWindows PowerShellを選択",
			selected: pwsh,
		});
	}
	await test("W02 workspace create/update/delete", async () => {
		const file = path.join(cwd, "mutation.txt");
		for (const content of ["created", "updated"]) {
			const result = await execute(
				shellArgs(
					pwsh,
					`Set-Content -LiteralPath ${quote(file)} -Encoding utf8 -Value ${quote(content)} -ErrorAction Stop`,
				),
			);
			assert.equal(result.exitCode, 0);
			assert.equal(
				(await readFile(file, "utf8")).replace(/^\uFEFF/, "").trim(),
				content,
			);
		}
		const result = await execute(
			shellArgs(
				pwsh,
				`Remove-Item -LiteralPath ${quote(file)} -ErrorAction Stop`,
			),
		);
		assert.equal(result.exitCode, 0);
		await assert.rejects(readFile(file), { code: "ENOENT" });
		return { created: true, updated: true, deleted: true };
	});
	await test("W09 Japanese path and short file output", async () => {
		const file = path.join(cwd, "日本語 空白.txt");
		const result = await execute(
			shellArgs(
				pwsh,
				`Set-Content -LiteralPath ${quote(file)} -Encoding utf8 -Value '日本語 $literal'; Get-Content -Encoding utf8 -LiteralPath ${quote(file)}; Remove-Item -LiteralPath ${quote(file)}`,
			),
		);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /日本語 \$literal/);
		await assert.rejects(readFile(file), { code: "ENOENT" });
		return result;
	});
	await test("W09 Windows PowerShell short Japanese output", async () => {
		const { result } = await executePiPowerShell(
			"Write-Output '日本語 $literal'",
			windowsShell,
		);
		assert.equal(result.exitCode, 0);
		assert.equal(result.stdout.trim(), "日本語 $literal");
		return result;
	});
	const external = path.join(outside, "外部.txt");
	await writeFile(external, "outside-safe");
	await test("W03 outside read", async () => {
		const result = await execute(
			shellArgs(pwsh, `Get-Content -LiteralPath ${quote(external)}`),
		);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /outside-safe/);
		return result;
	});
	for (const operation of ["create", "overwrite", "delete", "relative"]) {
		await test(`W04/W05 outside ${operation}`, async () => {
			const target =
				operation === "create"
					? path.join(outside, "created.txt")
					: external;
			let code = `Set-Content -LiteralPath ${quote(target)} -Value bad -ErrorAction Stop`;
			if (operation === "delete") {
				code = `Remove-Item -LiteralPath ${quote(target)} -ErrorAction Stop`;
			}
			if (operation === "relative") {
				code = `Set-Location ${quote(outside)}; Set-Content -LiteralPath '外部.txt' -Value bad -ErrorAction Stop`;
			}
			const result = await deniedWrite(shellArgs(pwsh, code));
			assert.equal(await readFile(external, "utf8"), "outside-safe");
			if (operation === "create") {
				await assert.rejects(readFile(target), { code: "ENOENT" });
			}
			return result;
		});
	}
	await test("W05 junction write", async () => {
		const junction = path.join(cwd, "linked");
		await symlink(outside, junction, "junction");
		const result = await deniedWrite(
			shellArgs(
				pwsh,
				`Set-Content -LiteralPath ${quote(path.join(junction, "外部.txt"))} -Value bad -ErrorAction Stop`,
			),
		);
		assert.equal(await readFile(external, "utf8"), "outside-safe");
		return result;
	});
	await test("W06 readOnly", async () => {
		const readOnly = { ...policy, writableRoots: [] };
		const target = path.join(cwd, "readonly.txt");
		const result = await deniedWrite(
			[
				process.execPath,
				"-e",
				`require('fs').writeFileSync(${JSON.stringify(target)},'bad')`,
			],
			{ policy: readOnly },
		);
		await assert.rejects(readFile(target), { code: "ENOENT" });
		return result;
	});
	await test("W06 multi-root", async () => {
		const multiple = await host.createWorkspaceAccessPolicy(
			[cwd, second],
			mode,
		);
		const result = await execute(
			[
				process.execPath,
				"-e",
				`const fs=require('fs'); fs.writeFileSync(${JSON.stringify(path.join(cwd, "multi.txt"))},'ok'); fs.writeFileSync(${JSON.stringify(path.join(second, "multi.txt"))},'ok')`,
			],
			{ policy: multiple },
		);
		assert.equal(result.exitCode, 0);
		assert.equal(
			await readFile(path.join(second, "multi.txt"), "utf8"),
			"ok",
		);
		return result;
	});
	await test("W07 descendants inherit write boundary", async () => {
		const grandchild = `const fs=require('fs'); fs.writeFileSync('grandchild-started.txt','started'); try { fs.writeFileSync(${JSON.stringify(external)},'bad'); process.exitCode=9; } catch { console.log('grandchild denied'); }`;
		const child = `require('fs').writeFileSync('child-started.txt','started'); const r=require('child_process').spawnSync(process.execPath,['-e',${JSON.stringify(grandchild)}],{encoding:'utf8'}); console.log(r.stdout); console.error(r.stderr); process.exit(r.status??8);`;
		const parent = `const r=require('child_process').spawnSync(process.execPath,['-e',${JSON.stringify(child)}],{encoding:'utf8'}); console.log(r.stdout); console.error(r.stderr); process.exit(r.status??8);`;
		const result = await execute([process.execPath, "-e", parent]);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /grandchild denied/);
		assert.equal(
			await readFile(path.join(cwd, "child-started.txt"), "utf8"),
			"started",
		);
		assert.equal(
			await readFile(path.join(cwd, "grandchild-started.txt"), "utf8"),
			"started",
		);
		assert.equal(await readFile(external, "utf8"), "outside-safe");
		return result;
	});
	for (const kind of ["stop", "timeout", "normal"]) {
		await test(`W08 ${kind} descendants`, async () => {
			const started = path.join(cwd, `${kind}-started.txt`);
			const counter = path.join(cwd, `${kind}-counter.txt`);
			const child = `const fs=require('fs'); fs.writeFileSync(${JSON.stringify(started)},'started'); setInterval(()=>fs.appendFileSync(${JSON.stringify(counter)},'x'),50)`;
			const middle = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'inherit'}); setInterval(()=>{},1000)`;
			const parent =
				kind === "normal"
					? `const child=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(middle)}],{stdio:'ignore'}); child.unref(); setTimeout(()=>process.exit(0),1000)`
					: `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(middle)}],{stdio:'inherit'}); setInterval(()=>{},1000)`;
			const abort = new AbortController();
			const running = execute([process.execPath, "-e", parent], {
				signal: abort.signal,
				timeoutMs: kind === "timeout" ? 4000 : 30_000,
			});
			const settled = running.then(
				(result) => ({ result }),
				(error) => ({ error: error.message }),
			);
			await until(
				async () =>
					(await readFile(started, "utf8").catch(() => "")) ===
					"started",
			);
			if (kind === "stop") {
				abort.abort();
			}
			const result = await settled;
			const before = await readFile(counter, "utf8").catch(() => "");
			await new Promise((resolve) => setTimeout(resolve, 400));
			assert.equal(
				await readFile(counter, "utf8").catch(() => ""),
				before,
				"停止後も子processが書き込んでいる",
			);
			return result;
		});
	}
	await test("W08 other connection survives Stop", async () => {
		const abort = new AbortController();
		const first = execute(
			[
				process.execPath,
				"-e",
				"require('fs').writeFileSync('isolation-first.txt','started'); setInterval(()=>{},1000)",
			],
			{ signal: abort.signal },
		);
		const firstResult = first.catch((error) => ({ error: error.message }));
		const secondCommand = execute([
			process.execPath,
			"-e",
			"require('fs').writeFileSync('isolation-second.txt','started'); setTimeout(()=>console.log('other session alive'),1200)",
		]);
		await until(
			async () =>
				(await readFile(
					path.join(cwd, "isolation-first.txt"),
					"utf8",
				).catch(() => "")) === "started" &&
				(await readFile(
					path.join(cwd, "isolation-second.txt"),
					"utf8",
				).catch(() => "")) === "started",
		);
		abort.abort();
		await firstResult;
		const result = await secondCommand;
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /other session alive/);
		return result;
	});
	for (const address of ["127.0.0.1", "::1"]) {
		const server = createServer((_request, response) =>
			response.end("nerita-network-fixture"),
		);
		servers.push(server);
		await new Promise((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, address, resolve);
		});
		const url = `http://${address.includes(":") ? `[${address}]` : address}:${server.address().port}`;
		await test(`W10 network ${address}`, () => networkComparison(url));
	}
	await test("W10 external HTTP example.com", () =>
		networkComparison("http://example.com"));
	await test("W10 external HTTPS example.com", () =>
		networkComparison("https://example.com"));
	await test("W12 extension development workspace", async () => {
		const developmentPolicy = await host.createWorkspaceAccessPolicy(
			[extensionPath],
			mode,
		);
		const result = await execute(
			[
				process.execPath,
				"-e",
				"console.log('development workspace works')",
			],
			{ cwd: await realpath(extensionPath), policy: developmentPolicy },
		);
		assert.equal(result.exitCode, 0);
		assert.match(result.stdout, /development workspace works/);
		return result;
	});
} finally {
	lifetime.abort();
	for (const server of servers) {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
	await writeFile(
		path.join(out, "results.json"),
		JSON.stringify(report, null, 2),
	);
	assert.equal(path.dirname(root), await realpath(tmpdir()));
	assert.ok(path.basename(root).startsWith("nerita-sandbox-smoke-"));
	await rm(root, { recursive: true, force: true });
}
console.log(`Results: ${path.join(out, "results.json")}`);
if (failed) {
	process.exitCode = 1;
}

/** 同じargv・cwd・env・policy・Windows実装で直結と本番Executorを比較する。 */
async function networkComparison(url) {
	let reachable;
	try {
		reachable = await fetch(url, {
			signal: AbortSignal.timeout(5000),
		}).then((result) => result.ok);
	} catch {
		reachable = false;
	}
	if (!reachable) {
		throw new Error(`未検証: Host対照が到達できない ${url}`);
	}
	const {
		call,
		result: production,
		toolResult,
	} = await executePiPowerShell(
		`try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri ${quote(url)}; Write-Output 'REACHABLE' } catch { Write-Output ('FAILED: ' + $_.Exception.Message); exit 3 }`,
	);
	const command = call.command;
	// 対照は同じ実行ファイル・argv・envの固定診断のみ。agent commandのHost fallbackではない。
	let hostShell;
	try {
		hostShell = await promisify(execFile)(command[0], command.slice(1), {
			cwd,
			windowsHide: true,
			timeout: 12000,
			env: Object.fromEntries(
				Object.entries(call.env).filter(([, value]) => value !== null),
			),
		});
	} catch (error) {
		hostShell = {
			stdout: error.stdout ?? "",
			stderr: error.stderr ?? "",
			error: error.message,
		};
	}
	const client = await host.CodexClient.connect({
		extensionPath,
		cwd,
		windowsSandbox: mode,
		clientInfo: {
			name: "nerita_sandbox_comparison",
			title: "Sandbox Comparison",
			version: "0.0.1",
		},
	});
	let direct;
	try {
		direct = await client.executeCommand({
			command,
			cwd,
			env: call.env,
			timeoutMs: call.timeoutMs,
			sandboxPolicy: host.toSandboxPolicy(call.policy),
		});
	} finally {
		await client.dispose();
	}
	const details = {
		url,
		hostReachable: reachable,
		hostShell,
		direct,
		production,
		toolResult,
		command,
		samePolicy: true,
		shellPolicyNetworkAccess: false,
	};
	report.cases.push({
		id: `W10-observation ${url}`,
		status: "observation",
		details,
	});
	if (!/^REACHABLE\r?$/m.test(hostShell.stdout)) {
		throw new Error(`未検証: 同じShellのHost対照が到達できない ${url}`);
	}
	assert.ok(
		!/^REACHABLE\r?$/m.test(direct.stdout),
		"直結がnetwork=falseでも到達した",
	);
	assert.ok(
		!/^REACHABLE\r?$/m.test(production.stdout),
		"本番Executorがnetwork=falseでも到達した",
	);
	assert.notEqual(direct.exitCode, 0);
	assert.notEqual(production.exitCode, 0);
	const denied = /10013|access permissions|アクセス許可で禁じられた/i;
	if (denied.test(direct.stdout) && denied.test(production.stdout)) {
		return details;
	}
	// timeoutだけではFirewallによる遮断を実証できない。
	throw new Error(`未検証: Hostは到達したがSandboxの失敗理由が未特定 ${url}`);
}
