// pnpm を構造化 argv で受け付け、既知の非互換だけを明示承認付き Host 経路へ送る。
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { realpath } from "node:fs/promises";
import { basename } from "node:path";
import { discoverDevTools } from "../../runtime/DevToolDiscovery";
import { initialDevToolProfiles } from "../../runtime/DevToolProfiles";
import { commandEnvironment } from "../../runtime/CommandEnvironment";
import { toolExecutionRoute } from "../../runtime/ToolExecutionRoute";
import { HostToolExecutor } from "../../runtime/HostToolExecutor";
import {
	approveToolCall,
	type ToolAuthorizer,
} from "../../security/ApprovalGuard";
import { containsPath } from "../../security/AgentAccessPolicy";
import type { WorkspacePathPolicy } from "../../security/WorkspacePathPolicy";
import type { SandboxCommandExecutor } from "../../runtime/SandboxCommandExecutor";
import { streamPiCommand } from "./PiCommandOutput";
import type { CredentialBroker } from "../../credentials/CredentialBroker";
import { CredentialExecutor } from "../../credentials/CredentialExecutor";

const input = z
	.object({
		args: z.array(z.string().max(16_384)).min(1).max(256),
		timeout: z.number().int().min(1).max(600).default(60),
	})
	.strict();

const parameters = {
	type: "object",
	properties: {
		args: { type: "array", items: { type: "string" } },
		timeout: { type: "number", description: "Timeout in seconds (1-600)" },
	},
	required: ["args"],
	additionalProperties: false,
} as const;

/** モデルが指定できるのは引数だけ。起動ファイルは Host が PATH と既知のプロファイルから解決する。 */
export function createPiPnpmTool(
	paths: WorkspacePathPolicy,
	authorize: ToolAuthorizer,
	sandbox: SandboxCommandExecutor,
	lifetime: AbortSignal,
	broker?: CredentialBroker,
): ToolDefinition {
	return {
		name: "pnpm",
		label: "pnpm",
		description:
			"Run pnpm with an argv array (no shell syntax). Native pnpm requires explicit host approval because of MXC incompatibility. Use this tool instead of invoking pnpm through PowerShell.",
		parameters,
		executionMode: "sequential",
		async execute(_id, params, signal, update) {
			const { args, timeout } = input.parse(params);
			const combined = signal
				? AbortSignal.any([signal, lifetime])
				: lifetime;
			combined.throwIfAborted();
			const cwd = await paths.resolveWorkspace(paths.cwd);
			const command = await resolvePnpmCommand(args, paths);
			const workspace = paths.policy.workspaceRoots
				.filter((root) => containsPath(root, cwd))
				.sort((a, b) => b.length - a.length)[0]!;
			const route = toolExecutionRoute(
				{
					tool: "pnpm",
					entrypoint: command.entrypoint,
					args,
					workspace,
				},
				"mxc",
			);
			const host = route.permission.route === "host";
			const sandboxInfo = sandbox.describe?.(paths.policy);
			const approved = await approveToolCall(
				{
					tool: "pnpm",
					params: {
						command: ["pnpm", ...args]
							.map((arg) => `'${arg.replaceAll("'", "''")}'`)
							.join(" "),
					},
					cwd,
					policy: paths.policy,
					command: command.argv,
					env: commandEnvironment(),
					timeoutMs: timeout * 1000,
					...(host
						? {
								hostShell: true,
								compatibility: route.compatibility!,
							}
						: { ...(sandboxInfo ? { sandbox: sandboxInfo } : {}) }),
				},
				authorize,
				combined,
			);
			const executor = host ? new HostToolExecutor() : sandbox;
			const result = await streamPiCommand(
				broker
					? new CredentialExecutor(executor, broker, authorize)
					: executor,
				approved,
				update,
			);
			return pnpmResult(result);
		},
	};
}

/** Phase 19 の結果保存へ stdout と stderr、終了コードを欠落なく返す。 */
function pnpmResult(result: {
	stdout: string;
	stderr: string;
	exitCode: number;
}) {
	return {
		content: [
			{
				type: "text" as const,
				text: [
					result.stdout,
					result.stderr,
					`Exit code: ${result.exitCode}`,
				]
					.filter(Boolean)
					.join("\n"),
			},
		],
		details: { exitCode: result.exitCode },
	};
}

/** 起動用ラッパー自体は起動せず、プロファイルが検出した実行ファイルか JavaScript のエントリーポイントを使う。 */
async function resolvePnpmCommand(args: string[], paths: WorkspacePathPolicy) {
	const tools = await discoverDevTools(
		commandEnvironment(),
		initialDevToolProfiles,
	);
	const entrypoint =
		tools.resources.find(
			(resource) =>
				resource.tool === "pnpm" &&
				resource.kind === "helper" &&
				/\.(exe|cjs|mjs)$/i.test(resource.target),
		)?.target ?? tools.executables["pnpm.exe"];
	if (!entrypoint) {
		throw new Error("pnpm の実行エントリーポイントを検出できません。");
	}
	const executable = await realpath(entrypoint);
	if (
		paths.policy.workspaceRoots.some((root) =>
			containsPath(root, executable),
		)
	) {
		throw new Error(
			"workspace 内の pnpm は実行エントリーポイントとして使用できません。",
		);
	}
	if (basename(executable).toLowerCase().endsWith(".exe")) {
		return { entrypoint: executable, argv: [executable, ...args] };
	}
	const node = tools.executables["node.exe"];
	if (
		!node ||
		paths.policy.workspaceRoots.some((root) => containsPath(root, node))
	) {
		throw new Error("信頼できる Node.js を検出できません。");
	}
	return { entrypoint: executable, argv: [node, executable, ...args] };
}
