// 実 MXC の通信・書込み境界・停止を検証する。実行: node tests/scratch/mxc-acceptance.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { build } = require("esbuild");
const { packageMxc } = require("../../config/package-mxc.cjs");

async function prepare() {
	const repo = path.resolve(__dirname, "../..");
	const extension = path.join(repo, "apps/vscode-nerita");
	const output = path.join(repo, "dist/mxc-acceptance.cjs");
	await packageMxc(path.join(extension, "dist/runtime"));
	await build({
		entryPoints: [
			path.join(extension, "src/extension/runtime/MxcExecutor.ts"),
		],
		outfile: output,
		bundle: true,
		platform: "node",
		format: "cjs",
	});
	const { executeMxcCommand } = require(output);
	const sdk = await import(
		pathToFileURL(
			path.join(
				extension,
				"dist/runtime/node_modules/@microsoft/mxc-sdk/dist/index.js",
			),
		).href
	);
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
	async function run(
		body,
		networkAccess = false,
		signal = new AbortController().signal,
		onOutput,
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
				timeoutMs: 15_000,
			},
			signal,
			onOutput,
		);
		console.log(result);
		return result;
	}
	return { run, root, workspace, shell };
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
		const tcp =
			"$client = New-Object Net.Sockets.TcpClient; try { $pending = $client.ConnectAsync('1.1.1.1', 443); if ($pending.Wait(4000) -and $client.Connected) { Write-Output 'CONNECTED' } else { Write-Output 'BLOCKED' } } catch { Write-Output 'BLOCKED' } finally { $client.Dispose() }";
		assert.match((await run(tcp)).stdout, /BLOCKED/);
		assert.match((await run(tcp, true)).stdout, /CONNECTED/);
		const failure = await run(
			"[Console]::Out.Write('stdout'); [Console]::Error.Write('stderr'); exit 7",
		);
		assert.equal(failure.exitCode, 7);
		assert.equal(failure.stdout, "stdout");
		assert.equal(failure.stderr, "stderr");
		await verifyStop(run, workspace, shell);
		console.log("MXC filesystem / raw TCP / output / Stop probes passed");
		const cwd = await run(
			"if ((Get-Location).Path -ne [Environment]::CurrentDirectory) { [Console]::Error.Write('PowerShell cwd mismatch'); exit 1 }; Write-Output 'CWD_OK'",
		);
		assert.equal(
			cwd.exitCode,
			0,
			"PowerShell が指定した cwd で実行できる必要があります",
		);
	} finally {
		await cleanup(root);
	}
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
