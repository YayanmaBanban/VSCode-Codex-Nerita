// 外部 MCP の HTTP 境界を提供し、承認前の通信と副作用の再送を観測する。
import { createServer } from "node:http";
import { once } from "node:events";

/** 通常結果・明示的失敗・実行後の応答喪失を外部サーバー側で選ぶ。 */
export async function mcpServer() {
	const token = "mcp-private-fixture-value";
	const calls: unknown[] = [];
	const methods: string[] = [];
	const state: { outcome: string; result: Record<string, unknown> } = {
		outcome: "success",
		result: {},
	};
	const server = createServer((request, response) => {
		if (request.headers.authorization !== `Bearer ${token}`) {
			response.writeHead(401).end();
			return;
		}
		if (request.method !== "POST") {
			response.writeHead(405).end();
			return;
		}
		let body = "";
		request.setEncoding("utf8");
		request.on("data", (chunk: string) => {
			body += chunk;
		});
		request.on("end", () => {
			const message = JSON.parse(body) as {
				id?: number;
				method: string;
				params?: unknown;
			};
			methods.push(message.method);
			if (message.id === undefined) {
				response.writeHead(204).end();
				return;
			}
			if (message.method === "tools/call") {
				calls.push(message.params);
				if (state.outcome === "lost") {
					response.destroy();
					return;
				}
			}
			const callResult =
				state.outcome === "error"
					? {
							isError: true,
							content: [
								{
									type: "text",
									text: "remote operation failed",
								},
							],
						}
					: state.result;
			const result =
				message.method === "tools/call"
					? callResult
					: protocolResult(message.method);
			response.writeHead(200, { "content-type": "application/json" });
			response.end(
				JSON.stringify({ jsonrpc: "2.0", id: message.id, result }),
			);
		});
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("MCP の起動に失敗しました。");
	}
	return {
		url: `http://127.0.0.1:${address.port}/mcp`,
		token,
		calls,
		methods,
		state,
		close: async () => {
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		},
	};
}

/** サーバーの公開契約だけを返し、製品の状態や判定は代行しない。 */
function protocolResult(method: string) {
	if (method === "initialize") {
		return {
			protocolVersion: "2025-11-25",
			capabilities: { tools: {} },
			serverInfo: { name: "fixture", version: "1" },
		};
	}
	if (method === "tools/list") {
		return {
			tools: [
				{
					name: "change",
					description: "record a change",
					inputSchema: { type: "object", properties: {} },
				},
			],
		};
	}
	throw new Error(`予定外の MCP 要求: ${method}`);
}
