// `Responses API` の応答だけを固定し、Codex 本体のシェル実行と結果を観測する。
// 認証ヘッダー・依頼本文は記録せず、検証用コマンドと結果だけを保持する。
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { once } = require("node:events");

async function modelServer(command) {
	const observations = [];
	const failures = [];
	let sequence = 0;
	const server = createServer(async (request, response) => {
		try {
			assert.equal(request.headers.authorization, undefined);
			if (
				request.method === "GET" &&
				request.url.startsWith("/v1/models?")
			) {
				response.writeHead(200, { "content-type": "application/json" });
				response.end(JSON.stringify({ models: [] }));
				return;
			}
			assert.match(request.url, /\/responses$/);
			const chunks = [];
			for await (const chunk of request) {
				chunks.push(chunk);
			}
			const body = JSON.parse(Buffer.concat(chunks).toString());
			const events = replyEvents(body, command, observations, ++sequence);
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.end(
				events
					.map(
						(event) =>
							`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
					)
					.join(""),
			);
		} catch (error) {
			failures.push(error.message);
			response.writeHead(500);
			response.end("probe fixture failed");
		}
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	return {
		url: `http://127.0.0.1:${server.address().port}/v1`,
		observations,
		failures,
		close: async () => {
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
		},
	};
}

/** 広告されたシェルツールを1回呼び、実際に戻ったツール結果を受け取って終了する。 */
function replyEvents(body, command, observations, sequence) {
	const output = (body.input ?? []).filter(
		(item) => item.type === "function_call_output",
	);
	const id = `probe-response-${sequence}`;
	const events = [{ type: "response.created", response: { id } }];
	if (output.length === 0) {
		const workdir = workingDirectory(body);
		const tool = (body.tools ?? []).find(
			(item) =>
				item.name === "exec_command" || item.name === "shell_command",
		);
		assert.ok(tool, "シェルツールが公開されていません。");
		const args =
			tool.name === "exec_command"
				? {
						cmd: command,
						workdir,
						yield_time_ms: 10000,
						login: false,
						max_output_tokens: 2048,
					}
				: { command, workdir, timeout_ms: 15000 };
		events.push({
			type: "response.output_item.done",
			item: {
				type: "function_call",
				name: tool.name,
				arguments: JSON.stringify(args),
				call_id: `probe-call-${sequence}`,
			},
		});
		observations.push({ tool: tool.name, workdir });
	} else {
		observations.push({ output: output.at(-1).output });
		events.push({
			type: "response.output_item.done",
			item: {
				type: "message",
				role: "assistant",
				id: `probe-message-${sequence}`,
				content: [{ type: "output_text", text: "probe completed" }],
			},
		});
	}
	events.push({
		type: "response.completed",
		response: {
			id,
			usage: {
				input_tokens: 0,
				output_tokens: 0,
				total_tokens: 0,
			},
		},
	});
	return events;
}

/** CLI がモデルへ渡した環境情報の cwd を、そのままシェル要求へ対応付ける。 */
function workingDirectory(body) {
	const text = (body.input ?? [])
		.flatMap((item) => item.content ?? [])
		.map((part) => part.text ?? "")
		.join("\n");
	const matches = [...text.matchAll(/<cwd>([^<]+)<\/cwd>/g)];
	assert.ok(
		matches.length > 0,
		"CLI の実行先がモデル要求に含まれていません。",
	);
	return matches.at(-1)[1];
}

module.exports = { modelServer };
