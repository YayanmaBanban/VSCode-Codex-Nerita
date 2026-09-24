// 承認snapshotと一回限りのpermitを検証し、表現できないpolicyは接続前に拒否する。
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { approveToolCall } from "../../src/extension/security/ApprovalGuard";
import {
	issueApprovedToolCall,
	consumeApprovedToolCall,
	toolCallFingerprint,
	type ToolCall,
} from "../../src/extension/security/ApprovedToolCall";
import { createWorkspaceAccessPolicy } from "../../src/extension/security/WorkspacePathPolicy";
import {
	CodexSandboxExecutor,
	type SandboxConnection,
} from "../../src/extension/backends/codex/CodexSandboxExecutor";
import { pending } from "./piHarness";

let root: string;
let call: ToolCall;
beforeEach(async () => {
	root = await realpath(
		await mkdtemp(join(tmpdir(), "nerita-sandbox-test-")),
	);
	call = {
		tool: "powershell",
		params: { command: "Get-Date" },
		cwd: root,
		policy: await createWorkspaceAccessPolicy([root]),
		command: ["pwsh", "-Command", "Get-Date"],
		env: { SECRET: null },
		timeoutMs: 1000,
	};
	call.policy.command.mode = "sandboxed";
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

it("承認中の変更は表示・permitのsnapshotへ反映されない", async () => {
	const approval = pending<AbortSignal>();
	const result = approveToolCall(call, () => approval.promise);
	call.command![2] = "Remove-Item .";
	call.env!.SECRET = "changed";
	call.policy.network.enabled = true;
	approval.resolve(new AbortController().signal);
	const frozen = consumeApprovedToolCall(await result);
	expect(frozen.command![2]).toBe("Get-Date");
	expect(frozen.env).toEqual({ SECRET: null });
	expect(frozen.policy.network.enabled).toBe(false);
});
it("拒否・取消からpermitを発行しない", async () => {
	await expect(
		approveToolCall(call, () => Promise.reject(new Error("reject"))),
	).rejects.toThrow("reject");
	const controller = new AbortController();
	controller.abort();
	await expect(
		approveToolCall(call, () => Promise.resolve(controller.signal)),
	).rejects.toThrow();
});
it("read名に偽装したcommandは自動承認しない", async () => {
	call.tool = "read";
	const authorize = vi.fn(() => Promise.reject(new Error("reject")));
	await expect(approveToolCall(call, authorize)).rejects.toThrow("reject");
	expect(authorize).toHaveBeenCalledOnce();
});
it("permitのコピー・再使用・改変を拒否する", () => {
	const permit = issueApprovedToolCall(call, new AbortController().signal);
	expect(() => consumeApprovedToolCall({ ...permit })).toThrow("再承認");
	expect(Object.isFrozen(permit.call.command)).toBe(true);
	consumeApprovedToolCall(permit);
	expect(() => consumeApprovedToolCall(permit)).toThrow("再承認");
	for (const changed of [
		{ ...call, cwd: `${root}x` },
		{ ...call, env: {} },
		{ ...call, command: ["changed"] },
	]) {
		expect(toolCallFingerprint(changed)).not.toBe(permit.fingerprint);
	}
});
it.each([false, true])(
	"network=%sでも有限の読取り範囲を表現できなければShellを起動しない",
	async (enabled) => {
		call.policy.network.enabled = enabled;
		call.policy.command.readAccess = "workspace";
		const connect = vi.fn();
		const executor = new CodexSandboxExecutor(connect, "win32");
		await expect(
			executor.execute(
				issueApprovedToolCall(call, new AbortController().signal),
			),
		).rejects.toThrow("読取り範囲");
		expect(connect).not.toHaveBeenCalled();
	},
);

/** RPC境界だけを模擬し、OS隔離の実機検証とは分ける。 */
function connected() {
	const client = {
		executeCommand: vi.fn<SandboxConnection["executeCommand"]>(() =>
			Promise.resolve({ stdout: "out", stderr: "err", exitCode: 7 }),
		),
		readSandboxReadiness: vi.fn<SandboxConnection["readSandboxReadiness"]>(
			() => Promise.resolve({ status: "ready" }),
		),
		terminateCommand: vi.fn(() => Promise.resolve({})),
		dispose: vi.fn(() => Promise.resolve()),
	};
	const connect = vi.fn(() => Promise.resolve(client));
	const verifyNetwork = vi.fn(() => Promise.resolve());
	return {
		client,
		connect,
		verifyNetwork,
		executor: new CodexSandboxExecutor(connect, "win32", verifyNetwork),
	};
}

it.each([false, true])(
	"全域readとnetwork=%sを承認snapshotどおりRPCへ渡す",
	async (network) => {
		call.policy.network.enabled = network;
		const { client, executor, verifyNetwork } = connected();
		const permit = await approveToolCall(call, () =>
			Promise.resolve(new AbortController().signal),
		);
		call.command![2] = "changed";
		call.policy.filesystem.writableRoots = [];
		const result = await executor.execute(permit);
		expect(result).toEqual({ stdout: "out", stderr: "err", exitCode: 7 });
		expect(client.executeCommand).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				command: ["pwsh", "-Command", "Get-Date"],
				cwd: root,
				env: { SECRET: null },
				timeoutMs: 1000,
				sandboxPolicy: {
					type: "workspaceWrite",
					writableRoots: [root],
					networkAccess: network,
					excludeTmpdirEnvVar: true,
					excludeSlashTmp: true,
				},
			}),
		);
		expect(verifyNetwork).toHaveBeenCalledTimes(network ? 0 : 1);
		expect(client.dispose).toHaveBeenCalledOnce();
		await expect(executor.execute(permit)).rejects.toThrow("再承認");
		expect(client.executeCommand).toHaveBeenCalledOnce();
	},
);

it("書込みrootがない子はreadOnlyを使いcwdへwriteを追加しない", async () => {
	call.policy.filesystem.writableRoots = [];
	const { client, executor } = connected();
	await executor.execute(
		issueApprovedToolCall(call, new AbortController().signal),
	);
	expect(client.executeCommand.mock.calls[0]?.[0].sandboxPolicy).toEqual({
		type: "readOnly",
		networkAccess: false,
	});
});

it.each(["protected", "cwd", "write-cwd"])(
	"%sの境界違反は接続前に拒否する",
	async (kind) => {
		if (kind === "protected") {
			call.policy.filesystem.protectedPaths = [join(root, "private")];
		}
		if (kind === "cwd") {
			call.policy.filesystem.workspaceRoots = [];
		}
		if (kind === "write-cwd") {
			call.policy.filesystem.writableRoots = [
				await realpath(process.cwd()),
			];
		}
		const { connect, executor } = connected();
		await expect(
			executor.execute(
				issueApprovedToolCall(call, new AbortController().signal),
			),
		).rejects.toThrow(/保護対象|cwd/);
		expect(connect).not.toHaveBeenCalled();
	},
);

it("readinessが未完了なら実行しない", async () => {
	const { client, executor } = connected();
	client.readSandboxReadiness.mockResolvedValue({ status: "notConfigured" });
	await expect(
		executor.execute(
			issueApprovedToolCall(call, new AbortController().signal),
		),
	).rejects.toThrow("セットアップ");
	expect(client.executeCommand).not.toHaveBeenCalled();
	expect(client.dispose).toHaveBeenCalledOnce();
});

it("切断時もHostへfallbackせず回収する", async () => {
	const { client, executor } = connected();
	client.executeCommand.mockRejectedValue(new Error("disconnected"));
	await expect(
		executor.execute(
			issueApprovedToolCall(call, new AbortController().signal),
		),
	).rejects.toThrow("disconnected");
	expect(client.executeCommand).toHaveBeenCalledOnce();
	expect(client.dispose).toHaveBeenCalledOnce();
});

it("Stop時は重複disposeせず子processの回収完了を待つ", async () => {
	const { client, executor } = connected();
	const controller = new AbortController();
	const started = pending<void>();
	const execution = pending<{
		stdout: string;
		stderr: string;
		exitCode: number;
	}>();
	const cleanup = pending<void>();
	client.executeCommand.mockImplementation(() => {
		started.resolve();
		return execution.promise;
	});
	client.dispose.mockImplementation(() => {
		execution.reject(new Error("stopped"));
		return cleanup.promise;
	});
	let finished = false;
	const running = executor
		.execute(issueApprovedToolCall(call, controller.signal))
		.finally(() => {
			finished = true;
		});
	const rejected = expect(running).rejects.toThrow("stopped");
	await started.promise;
	controller.abort();
	await vi.waitFor(() => expect(client.dispose).toHaveBeenCalledOnce());
	expect(finished).toBe(false);
	cleanup.resolve();
	await rejected;
	expect(client.dispose).toHaveBeenCalledOnce();
});
it.each([NaN, Infinity, -1, 0, 600001, 1.5])(
	"timeout=%sを拒否する",
	async (timeoutMs) => {
		call.timeoutMs = timeoutMs;
		const connect = vi.fn();
		await expect(
			new CodexSandboxExecutor(connect).execute(
				issueApprovedToolCall(call, new AbortController().signal),
			),
		).rejects.toThrow("未対応");
		expect(connect).not.toHaveBeenCalled();
	},
);
