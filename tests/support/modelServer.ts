// モデルの HTTP 境界だけを置き換え、要求とツール結果の実際の受け渡しを観測する。
import { createServer } from "node:http";
import { once } from "node:events";

/** モデルから返す本文またはツール呼び出し。製品の実行状態はここでは組み立てない。 */
export type ModelReply =
	| string
	| { name: string; arguments: Record<string, unknown> }
	| { error: { status: number; message: string } };

/** 応答順をテスト側で指定できる、ローカルのストリーミング API を起動する。 */
export async function modelServer() {
	const requests: string[] = [];
	const replies: ModelReply[] = [];
	const authorizations: (string | undefined)[] = [];
	const server = createServer((request, response) => {
		let body = "";
		request.setEncoding("utf8");
		request.on("data", (chunk: string) => {
			body += chunk;
		});
		request.on("end", () => {
			requests.push(body);
			authorizations.push(request.headers.authorization);
			const reply = replies.shift();
			if (reply === undefined) {
				response.writeHead(500);
				response.end("予定外のモデル要求");
				return;
			}
			if (typeof reply !== "string" && "error" in reply) {
				response.writeHead(reply.error.status, {
					"content-type": "application/json",
				});
				response.end(
					JSON.stringify({
						error: {
							message: reply.error.message,
							type: "invalid_request_error",
						},
					}),
				);
				return;
			}
			const text = typeof reply === "string";
			const delta = text
				? { role: "assistant", content: reply }
				: {
						role: "assistant",
						tool_calls: [
							{
								index: 0,
								id: `call-${requests.length}`,
								type: "function",
								function: {
									name: reply.name,
									arguments: JSON.stringify(reply.arguments),
								},
							},
						],
					};
			const chunk = (value: unknown, finish: string | null) =>
				`data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`;
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.end(
				`${chunk(delta, null)}${chunk({}, text ? "stop" : "tool_calls")}data: [DONE]\n\n`,
			);
		});
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!(address !== null) || typeof address === "string") {
		throw new Error("モデルの起動に失敗しました。");
	}
	return {
		url: `http://127.0.0.1:${address.port}/v1`,
		requests,
		authorizations,
		replies,
		close: async () => {
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		},
	};
}
