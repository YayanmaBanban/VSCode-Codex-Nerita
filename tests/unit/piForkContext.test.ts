// 親会話の固定、未完了のツール除外、モデルとサイズの制限を検証する。
import { expect, it } from "vitest";
import {
	forkContext,
	type PiForkMessage,
} from "../../src/extension/backends/pi/PiForkContext";
import { assistant } from "./piHarness";

const parent = { provider: "local", id: "test" };
const target = { provider: "local", model: "test" };
/** SDK の投影済み会話だけを提供する。 */
function source(messages: PiForkMessage[]) {
	return {
		buildSessionContext: () => ({
			messages,
			thinkingLevel: "off",
			model: null,
		}),
	};
}

it("未完了のツール呼出しを除き、完了した交換と本文をコピーする", () => {
	const complete = {
		...assistant(""),
		content: [
			{
				type: "toolCall" as const,
				id: "done",
				name: "read",
				arguments: {},
			},
		],
	};
	const incomplete = {
		...complete,
		content: [{ ...complete.content[0]!, id: "pending" }],
	};
	const messages: PiForkMessage[] = [
		{ role: "user", content: "parent text", timestamp: 1 },
		complete,
		{
			role: "toolResult",
			toolCallId: "done",
			toolName: "read",
			content: [{ type: "text", text: "read result" }],
			isError: false,
			timestamp: 2,
		},
		incomplete,
	];
	const snapshot = forkContext(source(messages), parent, target);
	expect(snapshot).toHaveLength(3);
	messages[0] = { role: "user", content: "changed", timestamp: 3 };
	expect(snapshot[0]).toMatchObject({ content: "parent text" });
});

it("モデル変更と過大な会話を複製しない", () => {
	expect(() =>
		forkContext(source([]), parent, { ...target, model: "other" }),
	).toThrow(/同じモデル/);
	expect(() =>
		forkContext(
			source([
				{
					role: "user",
					content: "x".repeat(4 * 1024 * 1024),
					timestamp: 1,
				},
			]),
			parent,
			target,
		),
	).toThrow(/上限/);
});
