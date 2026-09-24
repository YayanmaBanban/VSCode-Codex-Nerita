// 外部拡張のHost実行による権限昇格を拒否する。
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { approvePiTool } from "../../src/extension/backends/pi/PiApprovedTools";

it.each(["read", "ls", "write", "powershell", "subagent", "custom"])(
	"%sという名前でも拡張Toolは承認やHost実行へ進めない",
	async (name) => {
		const execute = vi.fn();
		const authorize = vi.fn(() =>
			Promise.resolve(new AbortController().signal),
		);
		const tool = approvePiTool(
			{ name, execute } as unknown as ToolDefinition,
			"D:/workspace",
			authorize,
			{
				filesystem: {
					readableRoots: ["D:/workspace"],
					writableRoots: [],
					protectedPaths: [],
				},
				network: { enabled: false },
				command: { mode: "deny" },
			},
		);
		const context: unknown = {};
		await expect(
			tool.execute(
				"id",
				{},
				undefined,
				undefined,
				context as Parameters<ToolDefinition["execute"]>[4],
			),
		).rejects.toThrow("Host実行");
		expect(authorize).not.toHaveBeenCalled();
		expect(execute).not.toHaveBeenCalled();
	},
);
