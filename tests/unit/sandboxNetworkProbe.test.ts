// Firewallルールが存在しても通信できる環境で、agent commandを開始しないことを検証する。
import { expect, it, vi } from "vitest";
import { verifySandboxNetwork } from "../../src/extension/backends/codex/SandboxNetworkProbe";
import {
	CodexSandboxExecutor,
	type SandboxConnection,
} from "../../src/extension/backends/codex/CodexSandboxExecutor";
import {
	issueApprovedToolCall,
	type ToolCall,
} from "../../src/extension/security/ApprovedToolCall";
import { realpath } from "node:fs/promises";

/** native curlだけを模擬し、接続漏れのケースでは実際に一時listenerへ到達する。 */
function connection(mode: "blocked" | "leaking" | "broken") {
	const executeCommand = vi.fn<SandboxConnection["executeCommand"]>(
		async (params) => {
			if (params.command.includes("--version")) {
				return { exitCode: 0, stdout: "curl 8.0", stderr: "" };
			}
			if (mode === "leaking") {
				return {
					exitCode: 0,
					stdout: await (await fetch(params.command.at(-1)!)).text(),
					stderr: "",
				};
			}
			return {
				exitCode: mode === "blocked" ? 7 : 2,
				stdout: "",
				stderr: "probe",
			};
		},
	);
	return {
		executeCommand,
		readSandboxReadiness: () =>
			Promise.resolve({ status: "ready" as const }),
		terminateCommand: () => Promise.resolve({}),
		dispose: vi.fn(() => Promise.resolve()),
	};
}
/** 実在するcwdを使い、ネットワークだけを制限した要求を作る。 */
async function request(): Promise<ToolCall> {
	const cwd = await realpath(process.cwd());
	return {
		tool: "powershell",
		params: { command: "agent command" },
		command: ["agent-command"],
		cwd,
		timeoutMs: 1000,
		policy: {
			filesystem: {
				readableRoots: [cwd],
				writableRoots: [cwd],
				protectedPaths: [],
			},
			network: { enabled: false },
			command: { mode: "sandboxed" },
		},
	};
}
it("接続拒否だけでは通信隔離の証明にしない", async () => {
	await expect(
		verifySandboxNetwork(connection("blocked"), await request()),
	).rejects.toThrow("通信隔離");
});
it.each(["leaking", "broken"] as const)(
	"%sではreadinessがreadyでもagent commandを拒否する",
	async (mode) => {
		const client = connection(mode);
		const executor = new CodexSandboxExecutor(
			() => Promise.resolve(client),
			"win32",
		);
		await expect(
			executor.execute(
				issueApprovedToolCall(
					await request(),
					new AbortController().signal,
				),
			),
		).rejects.toThrow("読取り範囲");
		expect(
			client.executeCommand.mock.calls.every(
				([params]) => params.command[0] !== "agent-command",
			),
		).toBe(true);
		expect(client.dispose).not.toHaveBeenCalled();
	},
);
