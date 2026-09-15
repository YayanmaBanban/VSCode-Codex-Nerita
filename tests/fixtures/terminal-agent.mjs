// Client側の5つの端末ハンドラーを実際のACP通信で呼び出す。
import { agent, ndJsonStream } from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
agent()
	.onRequest("initialize", ({ params }) => {
		if (!params.clientCapabilities?.terminal) {
			throw new Error("Terminal capability missing");
		}
		return { protocolVersion: 1 };
	})
	.onRequest("session/new", () => ({ sessionId: "terminal-session" }))
	.onRequest("session/prompt", async ({ client, params }) => {
		const sessionId = params.sessionId;
		const created = await client.request("terminal/create", {
			sessionId,
			command: process.execPath,
			args: [
				"-e",
				"console.log('terminal ready'); setInterval(() => {}, 1000)",
			],
			outputByteLimit: 1024,
		});
		const ref = { sessionId, terminalId: created.terminalId };
		await client.notify("session/update", {
			sessionId,
			update: {
				sessionUpdate: "tool_call",
				toolCallId: "cmd",
				kind: "execute",
				title: "test command",
				status: "in_progress",
				content: [{ type: "terminal", terminalId: ref.terminalId }],
			},
		});
		if (
			params.prompt[0].type === "text" &&
			params.prompt[0].text === "agent-kill"
		) {
			await client.request("terminal/kill", ref);
		}
		await client.request("terminal/wait_for_exit", ref);
		const output = await client.request("terminal/output", ref);
		await client.request("terminal/release", ref);
		await client.notify("session/update", {
			sessionId,
			update: {
				sessionUpdate: "tool_call_update",
				toolCallId: "cmd",
				status: "completed",
				rawOutput: output,
			},
		});
		return { stopReason: "end_turn" };
	})
	.connect(
		ndJsonStream(
			Writable.toWeb(process.stdout),
			Readable.toWeb(process.stdin),
		),
	);
