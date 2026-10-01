// 実 HTTP 通信で認証・副作用回数・切断・構造化結果を検証する一時 MCP サーバー。
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { once } from "node:events";
import { isRecord } from "@nerita/shared/validation";

/** MCP の通知と要求を区別し、模擬応答でも実際に届いた操作だけを数える。 */
export async function piHttpMcpFixture() {
	const methods: string[] = [];
	const calls: unknown[] = [];
	let expire = false;
	let slow = false;
	let tools = ["change"];
	let unauthorized = false;
	let resourceExpired = false;
	let output: unknown;
	const streams = new Set<ServerResponse>();
	const token = "mcp-fixture-private-value";
	const server = createServer((request, response) => {
		void handle(request, response).catch(() =>
			response.writeHead(500).end(),
		);
	});
	/** 認証を通った JSON-RPC のみ、MCP の状態に反映する。 */
	async function handle(request: IncomingMessage, response: ServerResponse) {
		if (request.url === "/token") {
			methods.push("oauth/token");
			response.writeHead(200, { "Content-Type": "application/json" });
			response.end(
				JSON.stringify({
					access_token: token,
					token_type: "Bearer",
					refresh_token: "fixture-rotated-refresh",
					expires_in: 3600,
				}),
			);
			return;
		}
		if (
			request.headers.authorization !== `Bearer ${token}` ||
			unauthorized
		) {
			response.writeHead(401).end();
			return;
		}
		if (request.method === "GET") {
			response.writeHead(200, { "Content-Type": "text/event-stream" });
			response.write(": connected\n\n");
			streams.add(response);
			response.on("close", () => streams.delete(response));
			return;
		}
		if (request.method !== "POST") {
			response.writeHead(405).end();
			return;
		}
		const chunks: Buffer[] = [];
		for await (const chunk of request) {
			chunks.push(Buffer.from(chunk as Uint8Array));
		}
		const message: unknown = JSON.parse(
			Buffer.concat(chunks).toString("utf8"),
		);
		if (!isRecord(message)) {
			response.writeHead(400).end();
			return;
		}
		rpc(message, request, response);
	}
	/** 接続要求と操作要求の応答を分け、副作用の再送を数える。 */
	function rpc(
		message: Record<string, unknown>,
		request: IncomingMessage,
		response: ServerResponse,
	): void {
		if (message.id === undefined) {
			response.writeHead(204).end();
			return;
		}
		const method = String(message.method);
		methods.push(method);
		if (method === "resources/read" && resourceExpired) {
			resourceExpired = false;
			response.writeHead(404).end();
			return;
		}
		if (method === "tools/call") {
			calls.push(message.params);
			if (expire) {
				response.writeHead(404).end();
				return;
			}
			if (slow) {
				request.on("close", () => response.destroy());
				return;
			}
		}
		const result = reply(method, message.params);
		response.writeHead(200, {
			"Content-Type": "application/json",
			"Mcp-Session-Id": "fixture-session",
		});
		response.end(
			JSON.stringify({ jsonrpc: "2.0", id: message.id, result }),
		);
	}
	/** 本文・構造化値・秘密値を同時に返し、保存前の変換を確認する。 */
	function reply(method: string, params: unknown): unknown {
		switch (method) {
			case "initialize":
				return {
					protocolVersion: "2025-11-25",
					capabilities: { tools: {}, resources: {} },
					serverInfo: { name: "fixture", version: "1" },
				};
			case "tools/list":
				return {
					tools: tools.map((name) => ({
						name,
						description: "change records",
						inputSchema: {
							type: "object",
							properties: { path: { type: "string" } },
							required: ["path"],
						},
					})),
				};
			case "tools/call":
				return (
					output ?? {
						content: [],
						structuredContent: {
							count: 3,
							token,
							echo: token,
							path:
								isRecord(params) && isRecord(params.arguments)
									? params.arguments.path
									: undefined,
						},
						_meta: { token },
					}
				);
			case "resources/list":
				return {
					resources: [{ uri: "fixture://record", name: "record" }],
				};
			case "resources/templates/list":
				return { resourceTemplates: [] };
			case "resources/read":
				return {
					contents: [
						{
							uri: "fixture://record",
							text: `record ${token}`,
							mimeType: "text/plain",
						},
					],
				};
			default:
				return {};
		}
	}
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("検証用サーバーを開始できません。");
	}
	return {
		url: `http://127.0.0.1:${address.port}/mcp`,
		token,
		methods,
		calls,
		setExpire: () => {
			expire = true;
		},
		setSlow: () => {
			slow = true;
		},
		setUnauthorized: () => {
			unauthorized = true;
		},
		setTools: (names: string[]) => {
			tools = names;
			for (const stream of streams) {
				stream.write(
					'data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\n',
				);
			}
		},
		streamCount: () => streams.size,
		expireResourceOnce: () => {
			resourceExpired = true;
		},
		setOutput: (result: unknown) => {
			output = result;
		},
		async close() {
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		},
	};
}
