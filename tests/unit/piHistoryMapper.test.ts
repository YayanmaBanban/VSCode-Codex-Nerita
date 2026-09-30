// 保存ブランチの表示順・同名ツール ID・停止状態を復元する。
import type { SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { restorePiHistory } from "../../apps/vscode-nerita/src/extension/backends/pi/PiHistoryMapper";
import { assistant } from "./piHarness";

/** 保存済み SDK メッセージへ安定した `entry` ID を付ける。 */
function entry(
	id: string,
	message: SessionMessageEntry["message"],
): SessionMessageEntry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: "2026-09-21T00:00:00Z",
		message,
	};
}

it("親の結果へ保存された多段の要約を復元し、省略・未完了を完了と扱わない", () => {
	const restored = restorePiHistory(
		[
			entry("u", { role: "user", content: "nested", timestamp: 1 }),
			entry("a", {
				...assistant(""),
				content: [
					{
						type: "toolCall",
						id: "outer",
						name: "outer",
						arguments: {},
					},
				],
			}),
			entry("r", {
				role: "toolResult",
				toolCallId: "outer",
				toolName: "outer",
				content: [{ type: "text", text: "parent result" }],
				isError: false,
				timestamp: 2,
				nestedCalls: {
					complete: false,
					calls: [
						{
							id: "outer/1",
							name: "read",
							arguments: { path: "child.txt" },
							status: "ok",
						},
						{
							id: "outer/1/1",
							name: "write",
							argumentsBytes: 8193,
							status: "error",
							error: "denied",
						},
						{ id: "outer/2", name: "custom", status: "unfinished" },
					],
				},
			}),
			entry("answer", assistant("done")),
		],
		"workspace",
	);
	expect(restored.tools).toMatchObject([
		{
			id: "outer",
			nestedCallsIncomplete: true,
			status: "completed",
			content: [{ content: { text: "parent result" } }],
		},
		{
			id: "outer/1",
			parentToolCallId: "outer",
			summaryOnly: true,
			rawInput: { path: "child.txt" },
			status: "completed",
			content: [],
		},
		{
			id: "outer/1/1",
			parentToolCallId: "outer/1",
			summaryOnly: true,
			omittedArgumentBytes: 8193,
			status: "failed",
			content: [{ content: { text: "denied" } }],
		},
		{
			id: "outer/2",
			parentToolCallId: "outer",
			summaryOnly: true,
			status: "unfinished",
			content: [],
		},
	]);
	expect(restored.tools.map((tool) => tool.order)).toEqual([2, 3, 4, 5]);
	expect(restored.tools[3]!.order).toBeLessThan(restored.messages[1]!.order!);
	expect(restored.tools[2]!.rawInput).toBeUndefined();
});

it("同じツールIDを別ターンで使っても結果と表示順が混ざらない", () => {
	const restored = restorePiHistory(
		[
			entry("u1", { role: "user", content: "first", timestamp: 1 }),
			entry("a1", {
				...assistant(""),
				content: [
					{ type: "text", text: "read now" },
					{
						type: "toolCall",
						id: "same",
						name: "read",
						arguments: { path: "a.txt" },
					},
				],
			}),
			entry("r1", {
				role: "toolResult",
				toolCallId: "same",
				toolName: "read",
				content: [{ type: "text", text: "file content" }],
				isError: false,
				timestamp: 2,
			}),
			entry("u2", { role: "user", content: "second", timestamp: 3 }),
			entry("a2", {
				...assistant(""),
				content: [
					{
						type: "toolCall",
						id: "same",
						name: "write",
						arguments: { path: "b.txt", content: "never written" },
					},
				],
			}),
		],
		"D:/moved",
	);
	expect(
		restored.tools.map((tool) => [tool.runId, tool.status, tool.cwd]),
	).toEqual([
		["history:u1", "completed", "D:/moved"],
		["history:u2", "cancelled", "D:/moved"],
	]);
	expect(restored.messages.every((message) => !message.streaming)).toBe(true);
	expect(restored.tools[0]!.order).toBeLessThan(restored.messages[2]!.order!);
	expect(restored.sessionTitle).toBe("first");
});

it("SDKの停止エラーを停止へ復元し、通常の失敗は失敗のまま残す", () => {
	for (const [text, expected] of [
		["Operation aborted", "cancelled"],
		["output\nCommand aborted", "cancelled"],
		["Command timed out after 3 seconds", "failed"],
	]) {
		const restored = restorePiHistory(
			[
				entry("r", {
					role: "toolResult",
					toolCallId: "t",
					toolName: "powershell",
					content: [{ type: "text", text: text! }],
					isError: true,
					timestamp: 1,
				}),
			],
			"D:/workspace",
		);
		expect(restored.tools[0]!.status).toBe(expected);
	}
});
