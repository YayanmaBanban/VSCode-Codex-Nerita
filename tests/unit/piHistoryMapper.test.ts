// 保存ブランチの表示順・同名ツールID・停止状態を復元する。
import type { SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { restorePiHistory } from "../../src/extension/backends/pi/PiHistoryMapper";
import { assistant } from "./piHarness";

/** 保存済みSDKメッセージへ安定したentry IDを付ける。 */
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
