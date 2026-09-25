// SDKの表示schemaだけを再利用し、実処理は承認済みのSandbox要求へ置き換える。
import { realpath } from "node:fs/promises";
import type { PowerShellExecutable } from "../../runtime/PowerShellExecutable";
import { powerShellCommand } from "../../runtime/PowerShellCommand";
import { containsPath } from "../../security/AgentAccessPolicy";
import { commandEnvironment } from "../../runtime/CommandEnvironment";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import type { SandboxCommandExecutor } from "../../runtime/SandboxCommandExecutor";
import {
	approveToolCall,
	type ToolAuthorizer,
} from "../../security/ApprovalGuard";
import { type WorkspacePathPolicy } from "../../security/WorkspacePathPolicy";

const powerShellInput = z.object({
	command: z.string().refine((value) => value.trim().length > 0),
	timeout: z.number().min(1).max(600).default(60),
});

/** timeout / argv / env / policyはHuman Approvalへ渡す前に確定する。 */
export function createPiSandboxPowerShellTool(
	definition: Omit<ToolDefinition, "renderCall" | "renderResult">,
	paths: WorkspacePathPolicy,
	authorize: ToolAuthorizer,
	executor: SandboxCommandExecutor,
	lifetime: AbortSignal,
	shell: PowerShellExecutable,
): ToolDefinition {
	return {
		...definition,
		executionMode: "sequential",
		async execute(_id, params, signal) {
			if (!paths.policy.shell) {
				throw new Error("このroleではShell実行が禁止されています。");
			}
			const { command, timeout } = powerShellInput.parse(params);
			const executionSignal = signal
				? AbortSignal.any([signal, lifetime])
				: lifetime;
			executionSignal.throwIfAborted();
			const cwd = await paths.resolveWorkspace(paths.cwd);
			const executable = await realpath(shell.executable);
			if (executable !== shell.executable) {
				throw new Error(
					"Shell実行ファイルの参照先が変更されました。Piへ再接続してください。",
				);
			}
			if (
				paths.policy.writableRoots.some((root) =>
					containsPath(root, executable),
				)
			) {
				throw new Error(
					"workspace内のPowerShell実行ファイルは使用できません。",
				);
			}
			const approved = await approveToolCall(
				{
					tool: shell.name,
					params: { command, timeout },
					cwd,
					policy: paths.policy,
					command: powerShellCommand(shell, command),
					env: commandEnvironment(),
					timeoutMs: Math.ceil(timeout * 1000),
					...(executor.describe
						? { sandbox: executor.describe(paths.policy) }
						: {}),
				},
				authorize,
				executionSignal,
			);
			const result = await executor.execute(approved);
			const text = [
				result.stdout,
				result.stderr,
				`Exit code: ${result.exitCode}`,
			]
				.filter(Boolean)
				.join("\n");
			return {
				content: [{ type: "text", text }],
				details: { exitCode: result.exitCode },
			};
		},
	};
}
