// 本文とツールの受信順・次の送信での履歴保持を検証する。
import { expect, it } from "vitest";
import { fixture } from "./fakeTransport";

it("本文をツール前後で分割し、次の送信でも履歴を保持する", async () => {
	const { controller, connections } = fixture();
	await controller.connect();
	const connection = connections[0]!;
	const sessionId = controller.snapshot().sessionId!;
	const turn = controller.receive({
		type: "prompt/send",
		requestId: "p",
		sessionId,
		text: "調べて",
	});
	try {
		const chunk = (text: string) =>
			connection.callbacks.update({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text },
				},
			});
		chunk("確認");
		chunk("します");
		connection.callbacks.update({
			sessionId,
			update: {
				sessionUpdate: "tool_call",
				toolCallId: "cmd",
				title: "test",
				kind: "execute",
				status: "in_progress",
			},
		});
		chunk("結果です");
		connection.callbacks.update({
			sessionId,
			update: {
				sessionUpdate: "tool_call_update",
				toolCallId: "cmd",
				status: "completed",
			},
		});
		chunk("。");
		const before = controller.snapshot();
		expect(before.messages.map((m) => m.text)).toEqual([
			"調べて",
			"確認します",
			"結果です。",
		]);
		expect(before.messages[1]!.order).toBeLessThan(before.tools[0]!.order!);
		expect(before.tools[0]!.order).toBeLessThan(before.messages[2]!.order!);
		connection.result.resolve({ stopReason: "end_turn" });
		await turn;
		await controller.receive({
			type: "prompt/send",
			requestId: "next",
			sessionId,
			text: "続けて",
		});
		expect(controller.snapshot().tools).toEqual(before.tools);
		expect(controller.snapshot().messages.at(-1)!.order).toBeGreaterThan(
			before.tools[0]!.order!,
		);
	} finally {
		await controller.dispose();
		await turn;
	}
});
