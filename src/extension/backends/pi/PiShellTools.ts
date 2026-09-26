// `powershell` と `pwsh` を別々に登録し、モデルに渡す説明を実際のシェルと揃える。
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { containsPath } from "../../security/AgentAccessPolicy";
import {
	approveToolCall,
	type ToolAuthorizer,
} from "../../security/ApprovalGuard";
import type { WorkspacePathPolicy } from "../../security/WorkspacePathPolicy";
import { commandEnvironment } from "../../runtime/CommandEnvironment";
import {
	resolvePowerShell,
	type PowerShellKind,
} from "../../runtime/PowerShellExecutable";
import type { SandboxCommandExecutor } from "../../runtime/SandboxCommandExecutor";
import { createPiSandboxPowerShellTool } from "./PiPowerShellTool";

/** 公開するツール名は解決済み実行ファイルと固定し、`pwsh` がなくても `powershell` を維持する。 */
export async function createPiShellTools(
	sdk: typeof PiSdk,
	paths: WorkspacePathPolicy,
	authorize: ToolAuthorizer,
	executor: SandboxCommandExecutor | null,
	signal: AbortSignal,
	unavailable?: string,
	onUnavailable?: () => void,
): Promise<PiSdk.ToolDefinition[]> {
	const tools: PiSdk.ToolDefinition[] = [];
	for (const name of ["powershell", "pwsh"] as const) {
		const definition = shellDefinition(sdk, paths.cwd, name);
		if (unavailable || !executor) {
			if (name === "powershell") {
				tools.push(
					unavailableTool(
						definition,
						unavailable ?? "Sandbox Executorが接続されていません。",
						onUnavailable,
					),
				);
			}
			continue;
		}
		try {
			const executable = await resolvePowerShell(name, async (path) => {
				if (
					paths.policy.writableRoots.some((root) =>
						containsPath(root, path),
					)
				) {
					return false;
				}
				return (
					name === "powershell" ||
					(await canStartPwsh(path, paths, executor, signal))
				);
			});
			signal.throwIfAborted();
			tools.push(
				createPiSandboxPowerShellTool(
					definition,
					paths,
					authorize,
					executor,
					signal,
					{ name, executable },
				),
			);
		} catch (error) {
			signal.throwIfAborted();
			if (name === "powershell") {
				tools.push(
					unavailableTool(
						definition,
						error instanceof Error ? error.message : String(error),
						onUnavailable,
					),
				);
			}
		}
	}
	return tools;
}

/** SDK の Host 実行・出力切詰め説明を持ち込まず、本番アダプターの契約をモデルへ渡す。 */
function shellDefinition(
	sdk: typeof PiSdk,
	cwd: string,
	name: PowerShellKind,
): PiSdk.ToolDefinition {
	const {
		renderCall: _call,
		renderResult: _result,
		...definition
	} = sdk.createPowerShellToolDefinition(cwd);
	const shell =
		name === "powershell"
			? "Windows PowerShell (powershell.exe)"
			: "PowerShell 7 (pwsh.exe)";
	return {
		...definition,
		name,
		label: shell,
		description: `Execute a command body in ${shell} through the configured sandbox executor. The tool starts this shell for you; pass the command body directly, for example node --version. Do not add a powershell -Command or pwsh -Command wrapper just to run the body. This tool does not switch to another shell. Every call requires user approval. Returns stdout, stderr and exit code when execution ends.`,
		parameters: {
			...definition.parameters,
			properties: {
				command: {
					type: "string",
					description: `Command body executed directly in ${shell}, e.g. node --version.`,
				},
				timeout: {
					type: "number",
					description: "Timeout in seconds (1 to 600, default 60).",
				},
			},
		},
	};
}

/** モデルへ具体的な利用不能理由を示し、別の実行経路には進ませない。 */
function unavailableTool(
	definition: PiSdk.ToolDefinition,
	reason: string,
	onUnavailable?: () => void,
): PiSdk.ToolDefinition {
	return {
		...definition,
		description: `${definition.description}\n現在利用できません: ${reason}`,
		execute: () => {
			onUnavailable?.();
			return Promise.reject(new Error(reason));
		},
	};
}

/** 起動確認はモデル入力を含まない固定処理。agent `command` の承認は省略しない。 */
async function canStartPwsh(
	executable: string,
	paths: WorkspacePathPolicy,
	executor: SandboxCommandExecutor,
	signal: AbortSignal,
): Promise<boolean> {
	try {
		const body =
			"if ($PSVersionTable.PSEdition -ne 'Core' -or $PSVersionTable.PSVersion.Major -lt 7) { exit 1 }; Write-Output 'NERITA_PWSH_READY'";
		const approved = await approveToolCall(
			{
				tool: "pwsh",
				params: { command: body },
				cwd: paths.cwd,
				policy: paths.policy,
				command: [
					executable,
					"-NoLogo",
					"-NoProfile",
					"-NonInteractive",
					"-Command",
					body,
				],
				env: commandEnvironment(),
				timeoutMs: 5000,
				...(executor.describe
					? { sandbox: executor.describe(paths.policy) }
					: {}),
			},
			() => Promise.resolve(signal),
			signal,
		);
		const result = await executor.execute(approved);
		return (
			result.exitCode === 0 &&
			result.stdout.trim() === "NERITA_PWSH_READY"
		);
	} catch {
		signal.throwIfAborted();
		return false;
	}
}
