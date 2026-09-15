// コマンド停止を管理下の端末に限定し、会話全体をキャンセルしないことを検証する。
import { expect, it, vi } from "vitest";
import { fixture } from "./fakeTransport";

it("古い端末を拒否し、現在のコマンドだけを停止する", async () => {
	const { controller, connections } = fixture();
	await controller.connect();
	const connection = connections[0]!;
	vi.mocked(connection.transport.terminalSnapshot).mockReturnValue({
		cwd: "D:/test",
		output: "",
		truncated: false,
		canStop: true,
	});
	const sessionId = controller.snapshot().sessionId!;
	const turn = controller.receive({
		type: "prompt/send",
		requestId: "p",
		sessionId,
		text: "test",
	});
	try {
		connection.callbacks.update({
			sessionId,
			update: {
				sessionUpdate: "tool_call",
				toolCallId: "tool",
				title: "test",
				kind: "execute",
				status: "in_progress",
				content: [{ type: "terminal", terminalId: "terminal" }],
			},
		});
		const request = {
			type: "terminal/kill",
			requestId: "stop",
			sessionId,
			runId: controller.snapshot().runId!,
			toolId: "tool",
			terminalId: "terminal",
		};
		for (const invalid of [
			{ sessionId: "old" },
			{ runId: "old" },
			{ toolId: "missing" },
			{ terminalId: "other" },
		]) {
			await controller.receive({
				...request,
				...invalid,
				requestId: JSON.stringify(invalid),
			});
		}
		expect(connection.transport.cancel).not.toHaveBeenCalled();
		await controller.receive(request);
		await controller.receive(request);
		expect(
			connection.transport.killTerminal,
		).toHaveBeenCalledExactlyOnceWith(sessionId, "terminal");
		expect(connection.transport.cancel).not.toHaveBeenCalled();
		expect(controller.snapshot().run).toBe("running");
		connection.result.resolve({ stopReason: "end_turn" });
		await turn;
		// ターン完了後も残る端末は、元のカードから個別に停止できる。
		await controller.receive({ ...request, requestId: "background" });
		expect(connection.transport.killTerminal).toHaveBeenCalledTimes(2);
		connection.callbacks.terminal?.(sessionId, "terminal", {
			cwd: "D:/test",
			output: "saved output",
			truncated: false,
			canStop: false,
			exitStatus: { exitCode: 0 },
		});
		expect(controller.snapshot().tools[0]?.terminal?.output).toBe(
			"saved output",
		);
		vi.mocked(connection.transport.terminalSnapshot).mockReturnValue(
			undefined,
		);
		await controller.receive({ ...request, requestId: "released" });
		expect(connection.transport.killTerminal).toHaveBeenCalledTimes(2);
	} finally {
		await controller.dispose();
		await turn;
	}
});
