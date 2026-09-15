// 通信とプロセスツリー終了を検証するための最小 ACP サーバー。
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const descendant = spawn(
	process.execPath,
	["-e", "setInterval(() => {}, 1000)"],
	{ windowsHide: true, stdio: "ignore" },
);
writeFileSync(
	join(process.cwd(), "pids.json"),
	JSON.stringify([process.pid, descendant.pid]),
);
process.stderr.write("private diagnostic\n");
createInterface({ input: process.stdin }).on("line", (line) => {
	const request = JSON.parse(line);
	let result;
	if (request.method === "initialize") {
		result = { protocolVersion: 1, authMethods: [] };
	}
	if (request.method === "session/new") {
		result = {
			sessionId: "fixture",
			models: { currentModelId: "model-a[high]" },
		};
	}
	if (request.method === "session/set_config_option") {
		writeFileSync(
			join(process.cwd(), "config.json"),
			JSON.stringify(request),
		);
		result = {
			configOptions: [
				{
					id: request.params.configId,
					type: "select",
					name: "Model",
					currentValue: request.params.value,
					options: [{ value: request.params.value, name: "Model A" }],
				},
			],
		};
	}

	if (request.method === "session/prompt") {
		if (request.params.prompt[0].text === "/status") {
			for (const text of [
				"**Account:** hidden@example.test\n",
				"**codex 5h limit:** 60% left (resets 18:00)",
			]) {
				process.stdout.write(
					`${JSON.stringify({
						jsonrpc: "2.0",
						method: "session/update",
						params: {
							sessionId: request.params.sessionId,
							update: {
								sessionUpdate: "agent_message_chunk",
								content: { type: "text", text },
							},
						},
					})}\n`,
				);
			}
			process.stdout.write(
				`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { stopReason: "end_turn" } })}\n`,
			);
			return;
		}
		writeFileSync(
			join(process.cwd(), "prompt.json"),
			JSON.stringify(request),
		);
		if (request.params.prompt[0].text === "disconnect") {
			process.stdout.end();
			return;
		}
		return;
	}
	if (result) {
		process.stdout.write(
			`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`,
		);
	}
});
