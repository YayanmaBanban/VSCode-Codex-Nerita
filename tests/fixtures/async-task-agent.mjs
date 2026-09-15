// SDKの標準型にないAIR通知を送るテスト用ACPサーバー。
import { createInterface } from "node:readline";
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const task = (update) =>
	send({
		jsonrpc: "2.0",
		method: "session/update",
		params: { sessionId: "air-session", update },
	});
createInterface({ input: process.stdin }).on("line", (line) => {
	const request = JSON.parse(line);
	let result;
	if (request.method === "initialize") {
		const capabilities = request.params.clientCapabilities;
		if (
			capabilities.terminal ||
			!capabilities._meta?.jetbrains?.air?.capabilities?.includes(
				"asyncTasks",
			)
		) {
			throw new Error("Invalid capabilities");
		}
		result = {
			protocolVersion: 1,
			_meta: {
				jetbrains: {
					air: { version: 1, capabilities: ["asyncTasks"] },
				},
			},
		};
	}
	if (request.method === "session/new") {
		result = { sessionId: "air-session" };
	}
	if (request.method === "session/prompt") {
		task({
			sessionUpdate: "tool_call",
			toolCallId: "cmd",
			title: "command",
			kind: "execute",
			status: "completed",
		});
		task({
			sessionUpdate: "async_task_spawned",
			asyncTaskId: "child:cmd",
			toolCallId: "cmd",
			name: "command",
			taskType: "shell",
			showInTranscript: false,
			canStop: true,
		});
		result = { stopReason: "end_turn" };
	}
	if (request.method === "_session/async_task/stop") {
		const stopped =
			request.params.sessionId === "air-session" &&
			request.params.asyncTaskId === "child:cmd";
		if (stopped) {
			task({
				sessionUpdate: "async_task_state_update",
				asyncTaskId: "child:cmd",
				toolCallId: "cmd",
				state: "stopped",
			});
		}
		result = { stopped };
	}
	if (result) {
		send({ jsonrpc: "2.0", id: request.id, result });
	}
});
