// MXC 本体の通信・書込み境界・停止を検証する。`node tests/scratch/mxc-acceptance.cjs` で実行する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { build } = require("esbuild");
const { packageMxc } = require("../../config/package-mxc.cjs");
const { createServer } = require("node:http");

async function prepare() {
	const repo = path.resolve(__dirname, "../..");
	const extension = path.join(repo, "apps/vscode-nerita");
	const output = path.join(repo, "dist/mxc-acceptance.cjs");
	await packageMxc(path.join(extension, "dist/runtime"));
	await build({
		stdin: {
			contents:
				"export { executeMxcCommand } from './apps/vscode-nerita/src/extension/runtime/MxcExecutor'; export { loadMxcSdk } from './apps/vscode-nerita/src/extension/runtime/MxcSdk';",
			resolveDir: repo,
			sourcefile: "mxc-acceptance.ts",
		},
		outfile: output,
		bundle: true,
		platform: "node",
		format: "cjs",
		conditions: ["nerita-source"],
	});
	const { executeMxcCommand, loadMxcSdk } = require(output);
	const sdk = await loadMxcSdk(extension);
	console.log(sdk.getPlatformSupport());
	const root = await fs.mkdtemp(
		path.join(os.tmpdir(), "nerita-mxc-acceptance-"),
	);
	const workspace = path.join(root, "workspace");
	await fs.mkdir(workspace);
	const shell = path.join(
		process.env.SystemRoot,
		"System32/WindowsPowerShell/v1.0/powershell.exe",
	);
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) =>
			/^(systemroot|windir|systemdrive|comspec|path|pathext|temp|tmp|userprofile|localappdata|appdata|programfiles|programdata)$/i.test(
				key,
			),
		),
	);
	return {
		run: createRun(sdk, executeMxcCommand, workspace, shell, env),
		root,
		workspace,
		shell,
	};
}

/** 本番の実行関数を固定した検証用呼出しを作る。 */
function createRun(sdk, executeMxcCommand, workspace, shell, env) {
	return async function run(
		body,
		networkAccess = false,
		signal = new AbortController().signal,
		onOutput,
		hostLoopbackAccess = false,
		timeoutMs = 15_000,
	) {
		body = `$ProgressPreference = 'SilentlyContinue'; [Console]::OutputEncoding = [Text.Encoding]::UTF8; ${body}`;
		const result = await executeMxcCommand(
			sdk,
			{
				tool: "acceptance",
				params: {},
				cwd: workspace,
				policy: {
					workspaceRoots: [workspace],
					writableRoots: [workspace],
					shell: true,
					networkAccess,
					hostLoopbackAccess,
					windowsSandbox: "elevated",
				},
				command: [
					shell,
					"-NoProfile",
					"-NonInteractive",
					"-EncodedCommand",
					Buffer.from(body, "utf16le").toString("base64"),
				],
				env,
				timeoutMs,
			},
			signal,
			onOutput,
		);
		console.log({
			exitCode: result.exitCode,
			stdoutBytes: Buffer.byteLength(result.stdout),
			stderrBytes: Buffer.byteLength(result.stderr),
			preview: result.stdout.slice(0, 200),
			error: result.stderr.slice(0, 1200),
		});
		return result;
	};
}

async function main() {
	const { run, root, workspace, shell } = await prepare();
	try {
		const write = await run(
			"[IO.File]::WriteAllText([IO.Path]::Combine([Environment]::CurrentDirectory, 'allowed.txt'), 'inside'); try { [IO.File]::WriteAllText([IO.Path]::Combine([Environment]::CurrentDirectory, '../denied.txt'), 'outside'); Write-Output 'ESCAPED' } catch { Write-Output 'DENIED' }",
		);
		assert.equal(write.exitCode, 0);
		assert.match(write.stdout, /DENIED/);
		assert.equal(
			await fs.readFile(path.join(workspace, "allowed.txt"), "utf8"),
			"inside",
		);
		await assert.rejects(fs.access(path.join(root, "denied.txt")));
		await observeOutsideRead(run, root);
		const tcp =
			"$client = New-Object Net.Sockets.TcpClient; try { $pending = $client.ConnectAsync('1.1.1.1', 443); if ($pending.Wait(4000) -and $client.Connected) { Write-Output 'CONNECTED' } else { Write-Output 'BLOCKED' } } catch { Write-Output 'BLOCKED' } finally { $client.Dispose() }";
		assert.match((await run(tcp)).stdout, /BLOCKED/);
		assert.match((await run(tcp, true)).stdout, /CONNECTED/);
		const networkComplete = await verifyNetwork(run);
		const failure = await run(
			"[Console]::Out.Write('stdout'); [Console]::Error.Write('stderr'); exit 7",
		);
		assert.equal(failure.exitCode, 7);
		assert.equal(failure.stdout, "stdout");
		assert.equal(failure.stderr, "stderr");
		await verifyStop(run, workspace, shell);
		await verifyLargeOutput(run);
		console.log("MXC filesystem / raw TCP / output / Stop probes passed");
		const cwd = await run(
			"if ((Get-Location).Path -ne [Environment]::CurrentDirectory) { [Console]::Error.Write('PowerShell cwd mismatch'); exit 1 }; Write-Output 'CWD_OK'",
		);
		assert.equal(
			cwd.exitCode,
			0,
			"PowerShell が指定した cwd で実行できる必要があります",
		);
		assert.equal(
			networkComplete,
			true,
			"Host loopback allow の受け入れ条件が未達です。native ProcessContainer 対応 Windows が必要です。",
		);
	} finally {
		await cleanup(root);
	}
}

/** 書込み拒否とは別に、下位 isolation tier でのワークスペース外読取りを観測する。 */
async function observeOutsideRead(run, root) {
	const probe = path.join(root, "outside-read.txt");
	await fs.writeFile(probe, "diagnostic fixture");
	const result = await run(
		`try { [void][IO.File]::ReadAllText('${probe.replaceAll("'", "''")}'); Write-Output 'OUTSIDE_READ_VISIBLE' } catch { Write-Output 'OUTSIDE_READ_DENIED' }`,
	);
	assert.match(result.stdout, /OUTSIDE_READ_(VISIBLE|DENIED)/);
	console.log(`MXC outside-read observation: ${result.stdout.trim()}`);
}

/** DNS・HTTPS・Host loopback を別々に検証し、外部通信許可が loopback 許可を兼ねないことも確認する。 */
async function verifyNetwork(run) {
	const dns =
		"try { $addresses = [Net.Dns]::GetHostAddresses('example.com'); if ($addresses.Length -gt 0) { Write-Output 'DNS_OK' } else { Write-Output 'DNS_BLOCKED' } } catch { Write-Output 'DNS_BLOCKED' }";
	assert.match((await run(dns, false)).stdout, /DNS_BLOCKED/);
	assert.match((await run(dns, true)).stdout, /DNS_OK/);
	const https =
		"[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { $client = New-Object Net.WebClient; $body = $client.DownloadString('https://example.com/'); if ($body.Contains('Example Domain')) { Write-Output 'HTTPS_OK' } else { exit 3 } } catch { Write-Output 'HTTPS_BLOCKED' } finally { if ($client) { $client.Dispose() } }";
	assert.match((await run(https, false)).stdout, /HTTPS_BLOCKED/);
	assert.match((await run(https, true)).stdout, /HTTPS_OK/);
	const server = createServer((_req, res) => res.end("HOST_LOOPBACK_OK"));
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	try {
		const port = server.address().port;
		const loopback = `try { $request = [Net.HttpWebRequest]::Create('http://127.0.0.1:${port}/'); $request.Timeout = 3000; $response = $request.GetResponse(); $reader = New-Object IO.StreamReader($response.GetResponseStream()); Write-Output ($reader.ReadToEnd()) } catch { Write-Output 'LOOPBACK_BLOCKED' } finally { if ($reader) { $reader.Dispose() }; if ($response) { $response.Dispose() } }`;
		assert.match((await run(loopback, false)).stdout, /LOOPBACK_BLOCKED/);
		assert.match((await run(loopback, true)).stdout, /LOOPBACK_BLOCKED/);
		const allowed = await run(
			loopback,
			false,
			new AbortController().signal,
			undefined,
			true,
		);
		if (
			allowed.exitCode !== 0 &&
			allowed.stderr.includes(
				"host-loopback ingress requires native ProcessContainer support",
			)
		) {
			console.error(
				"MXC ACCEPTANCE INCOMPLETE: Host loopback allow requires native ProcessContainer support on this Windows version.",
			);
			return false;
		}
		assert.match(allowed.stdout, /HOST_LOOPBACK_OK/);
		assert.match(
			(
				await run(
					dns,
					false,
					new AbortController().signal,
					undefined,
					true,
				)
			).stdout,
			/DNS_BLOCKED/,
		);
		console.log("MXC DNS / HTTPS / independent host loopback passed");
		return true;
	} finally {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
}

/** 出力のストリーム区分・逐次性と出力中の timeout を MXC 本体で確認する。 */
async function verifyLargeOutput(run) {
	const chunks = { stdout: 0, stderr: 0 };
	const body =
		"$line = 'x' * 1024; for ($i = 0; $i -lt 2048; $i++) { [Console]::Out.WriteLine('OUT:' + $line); [Console]::Error.WriteLine('ERR:' + $line) }; exit 7";
	const result = await run(
		body,
		false,
		new AbortController().signal,
		(stream, text) => {
			chunks[stream]++;
			assert.ok(text.length);
		},
	);
	assert.equal(result.exitCode, 7);
	assert.ok(result.stdout.length > 2_000_000);
	assert.ok(result.stderr.length > 2_000_000);
	assert.ok(chunks.stdout > 1 && chunks.stderr > 1);
	assert.ok(
		!result.stdout.includes("ERR:") && !result.stderr.includes("OUT:"),
	);
	let delivered = false;
	await assert.rejects(
		run(
			"while ($true) { [Console]::Out.WriteLine('TIMEOUT_OUTPUT'); Start-Sleep -Milliseconds 20 }",
			false,
			new AbortController().signal,
			() => {
				delivered = true;
			},
			false,
			2000,
		),
		/タイムアウト/,
	);
	assert.equal(delivered, true, "起動前失敗を timeout 検証の成功にしない");
	console.log("MXC large stdout / stderr / timeout passed");
}

/** 中止なしの対照実行で書込みを確認し、開始通知を受けてから同じ処理を止める。 */
async function verifyStop(run, workspace, shell) {
	const late = path.join(workspace, "late.txt");
	const body = `Start-Sleep -Seconds 3; [IO.File]::WriteAllText('${late.replaceAll("'", "''")}', 'late')`;
	const encoded = Buffer.from(body, "utf16le").toString("base64");
	const launch = `$start = New-Object Diagnostics.ProcessStartInfo; $start.FileName = '${shell.replaceAll("'", "''")}'; $start.Arguments = '-NoProfile -NonInteractive -EncodedCommand ${encoded}'; $start.UseShellExecute = $false; $start.CreateNoWindow = $true; $start.WorkingDirectory = [Environment]::CurrentDirectory; $child = [Diagnostics.Process]::Start($start); Write-Output 'CHILD_STARTED'; $child.WaitForExit()`;
	assert.equal((await run(launch)).exitCode, 0);
	assert.equal(await fs.readFile(late, "utf8"), "late");
	await fs.unlink(late);
	const controller = new AbortController();
	let started = false;
	const stopped = run(launch, false, controller.signal, (_stream, chunk) => {
		if (chunk.includes("CHILD_STARTED")) {
			started = true;
			controller.abort();
		}
	});
	await assert.rejects(stopped, /停止/);
	assert.equal(started, true, "子プロセスを起動した後に Stop する");
	await new Promise((resolve) => setTimeout(resolve, 4000));
	await assert.rejects(fs.access(late), { code: "ENOENT" });
}

/** 新規作成した一時領域だけを回収する。 */
async function cleanup(root) {
	if (
		path.dirname(root) !== os.tmpdir() ||
		!path.basename(root).startsWith("nerita-mxc-acceptance-")
	) {
		throw new Error("Unexpected cleanup path");
	}
	await fs.rm(root, { recursive: true, force: true });
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
