// 実Pi SDKとローカルOpenAI互換サーバーで、通信・read・Stopを外部認証なしで検証する。
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const projectRoot = process.cwd();
const fixture = await mkdtemp(path.join(tmpdir(), "nerita-pi-smoke-"));
const cwd = path.join(fixture, "workspace");
const agentDir = path.join(fixture, "agent");
const requests = [];
const errors = [];
const server = createServer((request, response) => {
	void (async () => {
		let body = "";
		for await (const chunk of request) {
			body += chunk;
		}
		const input = JSON.parse(body);
		requests.push(input);
		response.writeHead(200, { "content-type": "text/event-stream" });
		const send = (delta, finish = null) =>
			response.write(
				`data: ${JSON.stringify({
					id: "pi-smoke",
					object: "chat.completion.chunk",
					created: 1,
					model: "smoke",
					choices: [{ index: 0, delta, finish_reason: finish }],
				})}\n\n`,
			);
		const content = input.messages.findLast(
			(message) => message.role === "user",
		)?.content;
		const prompt =
			typeof content === "string"
				? content
				: content
						?.filter((part) => part.type === "text")
						.map((part) => part.text)
						.join("");
		send({ role: "assistant" });
		if (prompt === "stop") {
			send({ content: "停止待ち" });
			return;
		}
		if (prompt === "tool" && input.messages.at(-1)?.role !== "tool") {
			send({
				tool_calls: [
					{
						index: 0,
						id: "read-smoke",
						type: "function",
						function: {
							name: "read",
							arguments: JSON.stringify({ path: "hello.txt" }),
						},
					},
				],
			});
			send({}, "tool_calls");
		} else {
			send({ content: "こんにちは。" });
			send({ content: "Pi疎通完了。" });
			send({}, "stop");
		}
		response.end("data: [DONE]\n\n");
	})().catch((error) => {
		errors.push(error);
		response.destroy();
	});
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
let controller;
try {
	await mkdir(cwd);
	await mkdir(agentDir);
	await writeFile(path.join(cwd, "hello.txt"), "Pi read tool works");
	await writeFile(
		path.join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				local: {
					baseUrl: `http://127.0.0.1:${port}/v1`,
					api: "openai-completions",
					apiKey: "local-test-only",
					models: [
						{
							id: "smoke",
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
	// リポジトリ外に同梱資産を置き、開発用node_modulesによる依存の補完を防ぐ。
	await cp(
		path.join(projectRoot, "dist/runtime"),
		path.join(fixture, "dist/runtime"),
		{
			recursive: true,
			filter: (source) => path.basename(source) !== "@openai",
		},
	);
	await build({
		stdin: {
			contents:
				'export { PiSessionController } from "./src/extension/backends/pi/PiSessionController"; export { createPiRuntime } from "./src/extension/backends/pi/PiRuntime"; export { isHostMessage } from "./src/shared/hostMessageValidation";',
			resolveDir: projectRoot,
		},
		bundle: true,
		platform: "node",
		format: "cjs",
		target: "node22",
		outfile: "dist/pi-smoke/host.cjs",
	});
	const { PiSessionController, createPiRuntime, isHostMessage } =
		createRequire(import.meta.url)(
			path.join(projectRoot, "dist/pi-smoke/host.cjs"),
		);
	controller = new PiSessionController(async (signal) => ({
		cwd,
		session: await createPiRuntime({
			extensionPath: fixture,
			cwd,
			agentDir,
			signal,
			provider: "local",
			model: "smoke",
		}),
	}));
	const events = [];
	controller.subscribe((event) => {
		assert.ok(isHostMessage(event));
		events.push(event);
	});
	await controller.connect();
	assert.equal(
		controller.snapshot().connection,
		"ready",
		controller.snapshot().error,
	);
	let sequence = 0;
	const send = (text) =>
		controller.receive({
			type: "prompt/send",
			requestId: `smoke-${++sequence}`,
			sessionId: controller.snapshot().sessionId,
			text,
		});
	await send("hello");
	await until(() => controller.snapshot().run !== "running");
	assert.equal(
		controller.snapshot().run,
		"completed",
		controller.snapshot().error,
	);
	assert.equal(
		controller.snapshot().messages.at(-1).text,
		"こんにちは。Pi疎通完了。",
	);
	assert.ok(
		events.some(
			(event) =>
				event.type === "state/patch" &&
				event.patch.messages?.some(
					(message) => message.streaming && message.text,
				),
		),
	);
	await send("tool");
	await until(() => controller.snapshot().run !== "running");
	assert.equal(
		controller.snapshot().run,
		"completed",
		controller.snapshot().error,
	);
	assert.ok(
		requests.some((request) =>
			request.messages.some(
				(message) =>
					message.role === "tool" &&
					JSON.stringify(message.content).includes(
						"Pi read tool works",
					),
			),
		),
	);
	assert.ok(
		requests.every((request) =>
			request.tools.every((tool) =>
				["read", "ls"].includes(tool.function.name),
			),
		),
	);
	await send("stop");
	await until(
		() => controller.snapshot().messages.at(-1)?.text === "停止待ち",
	);
	await controller.receive({
		type: "prompt/cancel",
		requestId: "cancel",
		sessionId: controller.snapshot().sessionId,
		runId: controller.snapshot().runId,
	});
	await until(() => controller.snapshot().run === "cancelled");
	await send("resume");
	await until(() => controller.snapshot().run !== "running");
	assert.equal(
		controller.snapshot().run,
		"completed",
		controller.snapshot().error,
	);
	assert.deepEqual(errors, []);
	console.log(
		"PASS: packaged Pi SDK → prompt → stream → read tool → complete → stop → resume",
	);
} finally {
	await controller?.dispose();
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
	assert.equal(path.dirname(fixture), tmpdir());
	assert.ok(path.basename(fixture).startsWith("nerita-pi-smoke-"));
	await rm(fixture, { recursive: true, force: true });
}

/** 固定sleepで成功扱いせず、期限内に期待する状態へ到達するまで待つ。 */
async function until(check) {
	const deadline = Date.now() + 15000;
	while (!check()) {
		assert.ok(
			Date.now() < deadline,
			`Pi state timeout: ${JSON.stringify(controller.snapshot())}`,
		);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}
