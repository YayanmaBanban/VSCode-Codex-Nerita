// 固定スクリプトへJSONをstdinで渡す。agent入力をPowerShellソースやargvへ展開しない。
import { execFile } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { realpath } from "node:fs/promises";
import { containsPath } from "../security/AgentAccessPolicy";
import type { WorkspacePathPolicy } from "../security/WorkspacePathPolicy";
import { windowsFileSource } from "./WindowsFileSource";

const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
  Add-Type -TypeDefinition @'
${windowsFileSource}
'@
  $r = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $result = [NeritaFiles]::Run($r.operation, $r.path, [string[]]$r.roots, [string[]]$r.blocked, $r.content)
  ConvertTo-Json -Compress -Depth 4 -InputObject @{ value = $result }
} catch {
  $e = $_.Exception
  while ($e.InnerException) { $e = $e.InnerException }
  $code = $e.NativeErrorCode
  if ($e -is [IO.FileNotFoundException] -or $e -is [IO.DirectoryNotFoundException]) { $code = 2 }
  ConvertTo-Json -Compress -InputObject @{ error = $e.Message; code = $code }
  exit 1
}
`;

/** Hostの制約検査に加え、Win32で親と対象を固定した操作だけを許可する。 */
export async function windowsFileOperation(
	paths: WorkspacePathPolicy,
	operation: "read" | "image" | "write" | "mkdir" | "stat" | "list",
	path: string,
	signal: AbortSignal,
	content?: string,
): Promise<unknown> {
	signal.throwIfAborted();
	if (process.platform !== "win32") {
		throw new Error("安全なファイル操作はWindows専用です。");
	}
	const write = operation === "write" || operation === "mkdir";
	const target = await paths.resolve(
		path,
		operation === "write" ? "write" : "read",
	);
	// 承認済みcanonical pathが別の実体へ解決された場合も再承認する。
	if (target !== path) {
		throw new Error("ファイルパスが変更されました。再承認が必要です。");
	}
	signal.throwIfAborted();
	const windows = process.env.SystemRoot || "C:\\Windows";
	const temporary = await realpath(tmpdir());
	if (
		paths.policy.filesystem.writableRoots.some(
			(root) =>
				containsPath(root, temporary) || containsPath(root, windows),
		)
	) {
		throw new Error("broker実行環境を含む書込みrootは許可できません。");
	}
	// profile・workspace module・PATHを使わず、固定のWindowsモジュールだけをロードする。
	const env = {
		SystemRoot: windows,
		WINDIR: windows,
		PATH: join(windows, "System32"),
		TEMP: temporary,
		TMP: temporary,
		PSModulePath: join(windows, "System32/WindowsPowerShell/v1.0/Modules"),
	};
	const request = JSON.stringify({
		operation,
		path: target,
		roots: write
			? paths.policy.filesystem.writableRoots
			: paths.policy.filesystem.readableRoots,
		blocked: paths.policy.filesystem.protectedPaths,
		content:
			content === undefined
				? ""
				: Buffer.from(content, "utf8").toString("base64"),
	});
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const child = execFile(
			join(windows, "System32/WindowsPowerShell/v1.0/powershell.exe"),
			[
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-EncodedCommand",
				Buffer.from(script, "utf16le").toString("base64"),
			],
			{
				cwd: windows,
				env,
				windowsHide: true,
				timeout: 30_000,
				maxBuffer: 48 * 1024 * 1024,
				signal,
			},
			(error, stdout) => {
				/** abort通知だけでは完了せず、brokerの終了後に結果を返す。 */
				const complete = () => {
					try {
						signal.throwIfAborted();
						resolve(brokerResult(stdout, error));
					} catch (failure) {
						reject(
							failure instanceof Error
								? failure
								: new Error(String(failure)),
						);
					}
				};
				if (
					child.pid &&
					child.exitCode === null &&
					child.signalCode === null
				) {
					child.once("close", complete);
				} else {
					complete();
				}
			},
		);
		child.stdin?.on("error", () => {
			/* 終了結果をexecFileのcallbackで処理する。 */
		});
		child.stdin?.end(request);
	});
}

/** brokerの異常終了・不正な応答を成功扱いにしない。 */
function brokerResult(stdout: string, error: Error | null): unknown {
	if (!stdout.trim()) {
		throw new Error("File broker returned no result", { cause: error });
	}
	const result = JSON.parse(stdout) as {
		value?: unknown;
		error?: string;
		code?: number;
	};
	if (error || result.error) {
		const failure: NodeJS.ErrnoException = new Error(
			result.error ?? "File broker failed",
		);
		if (result.code === 2 || result.code === 3) {
			failure.code = "ENOENT";
			failure.message = `ENOENT: ${failure.message}`;
		}
		throw failure;
	}
	if (!("value" in result)) {
		throw new Error("Invalid file broker response");
	}
	return result.value;
}
