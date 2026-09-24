// 実SDKのTool定義を使い、Shellが禁止またはExecutor未接続なら登録しないことを確認する。
import * as sdk from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { createPiRuntimeTools } from "../../src/extension/backends/pi/PiRuntimeTools";
import type { AgentAccessPolicy } from "../../src/extension/security/AgentAccessPolicy";
import { WorkspacePathPolicy } from "../../src/extension/security/WorkspacePathPolicy";

/** 登録だけの検証ではfilesystemを操作せず、絶対cwdのpolicyを渡す。 */
function paths(mode: AgentAccessPolicy["command"]["mode"]) {
	const cwd = process.cwd();
	return new WorkspacePathPolicy(
		{
			filesystem: {
				readableRoots: [cwd],
				writableRoots: [cwd],
				protectedPaths: [],
			},
			network: { enabled: false },
			command: { mode, readAccess: "all" },
		},
		cwd,
	);
}

it.each(["deny", "host"] as const)(
	"command=%sではSDKのShellを登録しない",
	(mode) => {
		const executor = { execute: vi.fn() };
		const tools = createPiRuntimeTools(
			sdk,
			paths(mode),
			vi.fn(),
			new AbortController().signal,
			executor,
		);
		expect(tools.map((tool) => tool.name)).toEqual([
			"read",
			"ls",
			"write",
			"edit",
		]);
		expect(executor.execute).not.toHaveBeenCalled();
	},
);
it("Sandbox Executorが未接続ならShellを登録しない", () => {
	const tools = createPiRuntimeTools(
		sdk,
		paths("sandboxed"),
		vi.fn(),
		new AbortController().signal,
	);
	expect(tools.map((tool) => tool.name)).toEqual([
		"read",
		"ls",
		"write",
		"edit",
	]);
});
it("許可済みpolicyとExecutorがそろった場合だけ承認adapterを登録する", () => {
	const tools = createPiRuntimeTools(
		sdk,
		paths("sandboxed"),
		vi.fn(),
		new AbortController().signal,
		{ execute: vi.fn() },
	);
	expect(tools.map((tool) => tool.name)).toEqual([
		"read",
		"ls",
		"write",
		"edit",
		"powershell",
	]);
	expect(tools.at(-1)!.executionMode).toBe("sequential");
});

it.each(["finite-read", "protected-write"])(
	"%sを強制できなければShellを登録しない",
	(constraint) => {
		const policy = paths("sandboxed");
		if (constraint === "finite-read") {
			policy.policy.command.readAccess = "workspace";
		} else {
			policy.policy.filesystem.protectedPaths = [policy.cwd];
		}
		const tools = createPiRuntimeTools(
			sdk,
			policy,
			vi.fn(),
			new AbortController().signal,
			{ execute: vi.fn() },
		);
		expect(tools.some((tool) => tool.name === "powershell")).toBe(false);
	},
);
