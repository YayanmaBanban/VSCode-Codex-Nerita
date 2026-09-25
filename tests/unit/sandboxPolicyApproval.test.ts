// 承認内容の固定、実行許可の使い捨て、親と子の両方で許可される権限だけを残す処理を検証する。
import type { PermissionPresentation } from "../../src/shared/permission";
import { describe, expect, it, vi } from "vitest";
import { approveToolCall } from "../../src/extension/security/ApprovalGuard";
import {
	consumeApprovedToolCall,
	issueApprovedToolCall,
	type ToolCall,
} from "../../src/extension/security/ApprovedToolCall";
import {
	intersectPolicy,
	toSandboxPolicy,
} from "../../src/extension/security/AgentAccessPolicy";
import { commandEnvironment } from "../../src/extension/runtime/CommandEnvironment";
import {
	parseCommandResult,
	parseSandboxReadiness,
} from "../../src/extension/backends/codex/protocol/command";
import { pending } from "./piHarness";

/** ファイル `I/O` を伴わない、正規化済み要求。 */
function call(): ToolCall {
	return {
		tool: "powershell",
		params: {
			command: "日本語\n'$value'",
			nested: { content: "original" },
		},
		command: ["pwsh", "-Command", "original"],
		cwd: "D:\\workspace",
		env: { PATH: "original", TOKEN: null },
		timeoutMs: 1000,
		policy: {
			workspaceRoots: ["D:\\workspace"],
			writableRoots: ["D:\\workspace"],
			networkAccess: false,
			shell: true,
			windowsSandbox: "elevated",
		},
	};
}

describe("U01-U03 policy / snapshot", () => {
	it("承認待ちの元入力変更がargv・内容・env・timeout・policyへ伝わらない", async () => {
		const input = call();
		input.sandbox = { name: "Fixture Sandbox", details: ["original"] };
		const gate = pending<AbortSignal>();
		const authorize = vi.fn(
			(_title: PermissionPresentation) => gate.promise,
		);
		const approval = approveToolCall(input, authorize);
		input.command![2] = "changed";
		input.env!.PATH = "changed";
		input.timeoutMs = 9000;
		input.cwd = "D:\\outside";
		input.policy.writableRoots.push("D:\\outside");
		input.sandbox.name = "changed";
		input.sandbox.details[0] = "changed";
		(input.params.nested as { content: string }).content = "changed";
		gate.resolve(new AbortController().signal);
		const permit = await approval;
		expect(consumeApprovedToolCall(permit)).toEqual({
			...call(),
			guardrailsDigest: permit.call.guardrailsDigest,
			guardrailsPaths: [],
			sandbox: { name: "Fixture Sandbox", details: ["original"] },
		});
		expect(() => consumeApprovedToolCall(permit)).toThrow("再承認");
		expect(permit.call.guardrailsDigest).toMatch(/^[a-f0-9]{64}$/);
		expect(authorize.mock.calls[0]![0].fields).toContainEqual({
			id: "network",
			label: "Shell network設定",
			value: "無効",
			display: "text",
		});
	});
	it("偽造・コピー・改変したpermitを拒否し、元の許可は一度だけ消費する", () => {
		const permit = issueApprovedToolCall(
			call(),
			new AbortController().signal,
		);
		expect(() => consumeApprovedToolCall({ ...permit })).toThrow("再承認");
		expect(() =>
			consumeApprovedToolCall({ ...permit, fingerprint: "wrong" }),
		).toThrow();
		expect(Object.isFrozen(permit.call.policy.writableRoots)).toBe(true);
		expect(consumeApprovedToolCall(permit)).toEqual(call());
	});
	it("拒否と許可直後のStopではpermitを返さない", async () => {
		await expect(
			approveToolCall(call(), () => Promise.reject(new Error("拒否"))),
		).rejects.toThrow("拒否");
		const abort = new AbortController();
		await expect(
			approveToolCall(call(), () => {
				abort.abort();
				return Promise.resolve(abort.signal);
			}),
		).rejects.toThrow();
	});
	it("Host拡張は一律拒否せず、Sandbox外の承認を要求する", async () => {
		const authorize = vi.fn((_title: PermissionPresentation) =>
			Promise.resolve(new AbortController().signal),
		);
		const { command: _command, ...input } = call();
		await approveToolCall({ ...input, tool: "extension:web" }, authorize);
		expect(JSON.stringify(authorize.mock.calls[0]![0])).toContain(
			"Host権限・Sandbox外",
		);
	});
	it("roleが親より広いroots・network・Shellを要求しても拡大しない", () => {
		const parent = { ...call().policy, shell: false };
		const policy = intersectPolicy(parent, {
			writableRoots: ["D:\\", "E:\\other"],
			networkAccess: true,
			shell: true,
		});
		expect(policy).toEqual(parent);
		expect(toSandboxPolicy(policy)).toEqual({
			type: "workspaceWrite",
			writableRoots: ["D:\\workspace"],
			networkAccess: false,
			excludeTmpdirEnvVar: true,
			excludeSlashTmp: true,
		});
		expect(
			toSandboxPolicy(intersectPolicy(parent, { writableRoots: [] })),
		).toEqual({ type: "readOnly", networkAccess: false });
	});
});

it("U08 合成provider secretはnullで除去し、OS変数だけを継承する", () => {
	expect(
		commandEnvironment({
			OPENAI_API_KEY: "synthetic-secret",
			CUSTOM_PROVIDER_TOKEN: "synthetic-secret",
			PATH: "system-path",
			NODE_OPTIONS: "--inspect",
		}),
	).toEqual({
		OPENAI_API_KEY: null,
		CUSTOM_PROVIDER_TOKEN: null,
		PATH: "system-path",
		NODE_OPTIONS: null,
	});
});

it("U05 未知のreadinessと壊れたcommand結果を受け付けない", () => {
	expect(() => parseSandboxReadiness({ status: "unknown" })).toThrow();
	expect(() =>
		parseCommandResult({ exitCode: "0", stdout: "", stderr: "" }),
	).toThrow();
	expect(
		parseCommandResult({
			exitCode: 7,
			stdout: "日本語\r\n",
			stderr: "stderr",
		}),
	).toEqual({ exitCode: 7, stdout: "日本語\r\n", stderr: "stderr" });
});
