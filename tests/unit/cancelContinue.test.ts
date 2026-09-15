// 通常キャンセルとAIR未使用時の停止後も同じ接続で会話を続けられることを検証する。
import { expect, it, vi } from "vitest";
import { fixture, deferred } from "./fakeTransport";
import type { PromptResponse } from "@agentclientprotocol/sdk";

it("キャンセル完了後も履歴とセッションを保持し、次のターンを送信できる", async () => {
	const { controller, connections } = fixture();
	await controller.connect();
	const connection = connections[0]!;
	const sessionId = controller.snapshot().sessionId!;
	try {
		for (const index of [1, 2]) {
			const result = deferred<PromptResponse>();
			vi.mocked(connection.transport.prompt).mockReturnValueOnce(
				result.promise,
			);
			const turn = controller.receive({
				type: "prompt/send",
				requestId: `p${index}`,
				sessionId,
				text: `turn ${index}`,
			});
			const runId = controller.snapshot().runId!;
			connection.callbacks.update({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: `answer ${index}` },
				},
			});
			connection.callbacks.update({
				sessionId,
				update: {
					sessionUpdate: "tool_call",
					toolCallId: `cmd${index}`,
					title: "test",
					kind: "execute",
					status: "in_progress",
				},
			});
			await controller.receive(
				index === 1
					? {
							type: "execution/stop",
							requestId: `stop${index}`,
							sessionId,
							runId,
							toolId: `cmd${index}`,
						}
					: {
							type: "prompt/cancel",
							requestId: `stop${index}`,
							sessionId,
							runId,
						},
			);
			expect(controller.snapshot().run).toBe("cancelling");
			result.resolve({ stopReason: "cancelled" });
			await turn;
			expect(controller.snapshot()).toMatchObject({
				connection: "ready",
				sessionId,
				run: "cancelled",
				permissions: [],
			});
			expect(connection.transport.dispose).not.toHaveBeenCalled();
		}
		expect(connections).toHaveLength(1);
		expect(
			controller.snapshot().messages.map((message) => message.text),
		).toEqual(["turn 1", "answer 1", "turn 2", "answer 2"]);
		expect(controller.snapshot().tools).toHaveLength(2);
		expect(connection.transport.cancel).toHaveBeenCalledTimes(2);
		expect(connection.transport.stopAsyncTask).not.toHaveBeenCalled();
	} finally {
		await controller.dispose();
	}
});
