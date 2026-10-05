// 能力検出に加えて固定コマンドを起動し、DLL の存在だけで利用可能と判定しない。
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { commandEnvironment } from "./CommandEnvironment";
import { loadMxcSdk, type MxcSdk } from "./MxcSdk";
import { executeMxcCommand } from "./MxcExecutor";
import type { SandboxAvailability } from "./SandboxBackend";

/** 会話開始を必要としない診断入口。失敗時も取得できた能力情報を維持する。 */
export async function probeMxc(
	extensionPath: string,
	cwd: string,
	signal: AbortSignal,
): Promise<SandboxAvailability> {
	let status: SandboxAvailability = {
		id: "mxc",
		name: "Microsoft MXC",
		available: false,
		availableMethods: [],
		uiCapabilities: {},
	};
	try {
		const sdk = await loadMxcSdk(extensionPath);
		status = describeMxcSupport(sdk);
		if (status.reason) {
			return status;
		}
		const root = await realpath(cwd);
		const systemRoot = process.env.SystemRoot;
		if (!systemRoot) {
			throw new Error("Windows の SystemRoot を取得できません。");
		}
		const body =
			"if ((Get-Location).Path -ne [Environment]::CurrentDirectory) { [Console]::Error.Write('PowerShell cwd differs from the requested workspace'); exit 1 }; Write-Output 'NERITA_MXC_READY'";
		const result = await executeMxcCommand(
			sdk,
			{
				tool: "mxc-startup-probe",
				params: {},
				cwd: root,
				policy: {
					workspaceRoots: [root],
					writableRoots: [],
					shell: true,
					networkAccess: false,
					windowsSandbox: "elevated",
				},
				command: [
					join(
						systemRoot,
						"System32",
						"WindowsPowerShell",
						"v1.0",
						"powershell.exe",
					),
					"-NoLogo",
					"-NoProfile",
					"-NonInteractive",
					"-EncodedCommand",
					Buffer.from(body, "utf16le").toString("base64"),
				],
				env: commandEnvironment(),
				timeoutMs: 10_000,
			},
			signal,
		);
		if (
			result.exitCode !== 0 ||
			result.stdout.trim() !== "NERITA_MXC_READY"
		) {
			throw new Error(
				`MXC 起動 Probe に失敗しました (${result.exitCode}): ${result.stderr || result.stdout}`,
			);
		}
		return { ...status, available: true };
	} catch (error) {
		signal.throwIfAborted();
		return {
			...status,
			available: false,
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}

/** ProcessContainer を利用できないホストで、別の隔離方式へ暗黙に切り替えない。 */
function describeMxcSupport(sdk: MxcSdk): SandboxAvailability {
	const support = sdk.getPlatformSupport();
	return {
		id: "mxc",
		name: "Microsoft MXC",
		available: false,
		availableMethods: [...support.availableMethods],
		uiCapabilities: { ...support.uiCapabilities },
		...(support.isolationTier
			? { isolationTier: support.isolationTier }
			: {}),
		...(!support.isSupported ||
		!support.availableMethods.includes("processcontainer")
			? {
					reason:
						support.reason || "ProcessContainer が利用できません。",
				}
			: {}),
	};
}
