// 実 SDK に決めた Tool Call を返し、外部モデルを使わず承認経路を検証する。
import { createServer } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

/** 専用の作業場所・認証設定・ローカルモデルを用意する。 */
export async function guardrailsFixture() {
	const root = await mkdtemp(join(tmpdir(), "nerita-guard-integration-"));
	const cwd = join(root, "workspace");
	const agentDir = join(root, "agent");
	await Promise.all([mkdir(cwd), mkdir(agentDir)]);
	let invocation: { name: string; arguments: Record<string, unknown> } = {
		name: "write",
		arguments: { path: "result.txt", content: "approved" },
	};
	let childInvocation: typeof invocation | undefined;
	const requests: string[] = [];
	const server = createServer((request, response) => {
		let body = "";
		request.setEncoding("utf8");
		request.on("data", (chunk: string) => {
			body += chunk;
		});
		request.on("end", () => {
			requests.push(body);
			const selected =
				childInvocation && !body.includes('"name":"subagent"')
					? childInvocation
					: invocation;
			const used = body.includes('"role":"tool"');
			const delta = used
				? { role: "assistant", content: "finished" }
				: {
						role: "assistant",
						tool_calls: [
							{
								index: 0,
								id: "fixture-call",
								type: "function",
								function: {
									name: selected.name,
									arguments: JSON.stringify(
										selected.arguments,
									),
								},
							},
						],
					};
			const chunk = (value: unknown, finish: string | null) =>
				`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "guard", choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`;
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.end(
				`${chunk(delta, null)}${chunk({}, used ? "stop" : "tool_calls")}data: [DONE]\n\n`,
			);
		});
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("ローカルモデルを起動できません。");
	}
	await writeFile(
		join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				local: {
					baseUrl: `http://127.0.0.1:${address.port}/v1`,
					api: "openai-completions",
					apiKey: "fixture-only",
					models: [
						{
							id: "guard",
							reasoning: false,
							input: ["text"],
							contextWindow: 8192,
							maxTokens: 128,
						},
					],
				},
			},
		}),
	);
	return {
		requests,
		setChildTool: (name: string, args: Record<string, unknown>) => {
			childInvocation = { name, arguments: args };
		},
		root,
		cwd,
		agentDir,
		setTool: (name: string, args: Record<string, unknown>) => {
			invocation = { name, arguments: args };
		},
		close: async () => {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
