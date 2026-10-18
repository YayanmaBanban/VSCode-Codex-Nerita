// Codex 本体が送信する `Responses API` の通信先をローカルの HTTP サーバーで代替する。
import { createServer } from "node:http";
import { once } from "node:events";
import { z } from "zod";
import { errorText } from "@nerita/shared/errorText";

const requestSchema = z.looseObject({
	model: z.string(),
	input: z.array(z.unknown()).optional(),
});
type Reply =
	| string
	| { name: string; namespace?: string; arguments: Record<string, unknown> };

/** 子の応答と親のツール呼出しを、受信した要求に応じて返す。実行状態は Codex が管理する。 */
export async function responsesServer(
	reply: (request: z.infer<typeof requestSchema>) => Reply,
) {
	const requests: z.infer<typeof requestSchema>[] = [];
	const server = createServer((request, response) => {
		let body = "";
		request.setEncoding("utf8");
		request.on("data", (chunk: string) => {
			body += chunk;
		});
		request.on("end", () => {
			try {
				const parsed = requestSchema.parse(JSON.parse(body));
				requests.push(parsed);
				const result = reply(parsed);
				const id = `local-${requests.length}`;
				response.writeHead(200, {
					"content-type": "text/event-stream",
				});
				response.end(encodeReply(result, id));
			} catch (error) {
				response.writeHead(500);
				response.end(errorText(error));
			}
		});
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error(
			"ローカルの HTTP サーバーの待ち受けアドレスを取得できませんでした。",
		);
	}
	return {
		requests,
		url: `http://127.0.0.1:${address.port}/v1`,
		close: () => {
			server.closeAllConnections();
			return new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		},
	};
}

/** イベントを JSON に変換し、SSE のデータ行として返す。 */
function responseEvent(event: unknown) {
	return `data: ${JSON.stringify(event)}\n\n`;
}

/** 受信した順序の ID を付け、本文または関数呼出しをストリーミングで返す。 */
function encodeReply(result: Reply, id: string) {
	const item =
		typeof result === "string"
			? {
					id,
					type: "message",
					role: "assistant",
					content: [
						{
							type: "output_text",
							text: result,
							annotations: [],
						},
					],
				}
			: {
					id,
					type: "function_call",
					call_id: id,
					name: result.name,
					namespace: result.namespace,
					arguments: JSON.stringify(result.arguments),
				};
	return [
		{
			type: "response.output_item.done",
			output_index: 0,
			item,
		},
		{
			type: "response.completed",
			response: {
				id,
				status: "completed",
				output: [item],
				usage: {
					input_tokens: 1,
					output_tokens: 1,
					total_tokens: 2,
				},
			},
		},
	]
		.map(responseEvent)
		.join("");
}
