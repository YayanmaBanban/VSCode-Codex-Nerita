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
import { CodexSandboxExecutor } from "../../src/extension/backends/codex/CodexSandboxExecutor";
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
