// SDKの表示schemaだけを再利用し、実処理は承認済みのSandbox要求へ置き換える。
import { resolvePowerShell } from "../../runtime/PowerShellExecutable";
import { containsPath } from "../../security/AgentAccessPolicy";
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

/** providerのtokenなどをShellへ継承しない。値は承認前に固定する。 */
function commandEnvironment(): Record<string, string | null> {
	const keep =
		/^(?:systemroot|windir|systemdrive|comspec|path|pathext|temp|tmp|programfiles|programfiles\(x86\)|programdata|userprofile|homedrive|homepath|localappdata|appdata|os|processor_architecture|number_of_processors)$/i;
	return Object.fromEntries(
		Object.keys(process.env).map((key) => [
			key,
			keep.test(key) ? (process.env[key] ?? null) : null,
		]),
	);
}

/** timeout / argv / env / policyはHuman Approvalへ渡す前に確定する。 */
export function createPiSandboxPowerShellTool(
	definition: Omit<ToolDefinition, "renderCall" | "renderResult">,
	paths: WorkspacePathPolicy,
	authorize: ToolAuthorizer,
	executor: SandboxCommandExecutor,
	lifetime: AbortSignal,
	shell = resolvePowerShell,
): ToolDefinition {
	return {
		...definition,
		executionMode: "sequential",
		async execute(_id, params, signal) {
			if (paths.policy.command.mode !== "sandboxed") {
				throw new Error(
					"Shellの読取り範囲・通信隔離を強制できないため、PowerShell実行を停止しています。",
				);
			}
			const { command, timeout } = powerShellInput.parse(params);
			const executionSignal = signal
				? AbortSignal.any([signal, lifetime])
				: lifetime;
			executionSignal.throwIfAborted();
			const cwd = await paths.resolve(paths.cwd, "read");
			const executable = await shell();
			if (
				paths.policy.filesystem.writableRoots.some((root) =>
					containsPath(root, executable),
				)
			) {
				throw new Error(
					"workspace内のPowerShell実行ファイルは使用できません。",
				);
			}
			const approved = await approveToolCall(
				{
					tool: "powershell",
					params: { command, timeout },
					cwd,
					policy: paths.policy,
					command: [
						executable,
						"-NoLogo",
						"-NoProfile",
						"-NonInteractive",
						"-OutputFormat",
						"Text",
						"-EncodedCommand",
						Buffer.from(
							`$ProgressPreference = 'SilentlyContinue'\ntry { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\n${command}`,
							"utf16le",
						).toString("base64"),
					],
					env: commandEnvironment(),
					timeoutMs: Math.ceil(timeout * 1000),
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
