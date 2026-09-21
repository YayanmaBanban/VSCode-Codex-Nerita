// VS Code内のNode.jsで同梱Pi SDKを動かし、外部通信なしで本文とStopを確認する。
import * as assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, basename, join } from "node:path";
import { PiSessionController } from "../src/extension/backends/pi/PiSessionController";
import { createPiRuntime } from "../src/extension/backends/pi/PiRuntime";

/** Extension Host上でもESMの動的ロードとストリーム中断が成立することを確認する。 */
export async function piExtensionSmoke(extensionPath: string): Promise<void> {
	const fixture = await mkdtemp(join(tmpdir(), "nerita-pi-host-"));
	const agentDir = join(fixture, "agent");
	const server = createServer((request, response) => {
		let body = "";
		request.setEncoding("utf8");
		request.on("data", (chunk: string) => {
			body += chunk;
		});
		request.on("end", () => {
			const tool =
				body.includes('"tool"') && !body.includes('"role":"tool"');
			const write =
				body.includes('"host-write"') &&
				!body.includes('"role":"tool"');
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.write(
				`data: ${JSON.stringify({
					id: "host-smoke",
					object: "chat.completion.chunk",
					created: 1,
					model: "smoke",
					choices: [
						{
							index: 0,
							delta:
								tool || write
									? {
											role: "assistant",
											tool_calls: [
												{
													index: 0,
													id: "host-ls",
													type: "function",
													function: {
														name: write
															? "write"
															: "ls",
														arguments: write
															? '{"path":"approved.txt","content":"Host approved"}'
															: '{"path":"."}',
													},
												},
											],
										}
									: {
											role: "assistant",
											content: "Pi Host OK",
										},
							finish_reason: null,
						},
					],
				})}\n\n`,
			);
			if (!body.includes('"stop"')) {
				response.end(
					`data: ${JSON.stringify({
						id: "host-smoke",
						object: "chat.completion.chunk",
						created: 1,
						model: "smoke",
						choices: [
							{
								index: 0,
								delta: {},
								finish_reason:
									tool || write ? "tool_calls" : "stop",
							},
						],
					})}\n\ndata: [DONE]\n\n`,
				);
			}
		});
	});
	let controller: PiSessionController | undefined;
	try {
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		assert.ok(address && typeof address === "object");
		await mkdir(agentDir);
		await writeFile(
			join(agentDir, "models.json"),
			JSON.stringify({
				providers: {
					local: {
						baseUrl: `http://127.0.0.1:${address.port}/v1`,
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
		controller = new PiSessionController(
			async (signal, authorize, resume) => ({
				cwd: fixture,
				session: await createPiRuntime({
					extensionPath,
					cwd: fixture,
					agentDir,
					signal,
					authorize,
					storage: "workspace",
					...(resume ? { resume } : {}),
					provider: "local",
					model: "smoke",
				}),
			}),
		);
		const session = controller;
		await session.connect();
		assert.equal(
			session.snapshot().connection,
			"ready",
			session.snapshot().error ?? undefined,
		);
		await session.receive({
			type: "prompt/send",
			requestId: "hello",
			sessionId: session.snapshot().sessionId,
			text: "hello",
		});
		await until(() => session.snapshot().run !== "running");
		assert.equal(
			session.snapshot().run,
			"completed",
			session.snapshot().error ?? undefined,
		);
		assert.equal(session.snapshot().messages.at(-1)?.text, "Pi Host OK");
		// 新規会話で書き込み要求を発行し、Hostでも許可前の副作用がないことを確認する。
		await session.receive({
			type: "prompt/send",
			requestId: "write-send",
			sessionId: session.snapshot().sessionId,
			text: "host-write",
		});
		await until(() => session.snapshot().permissions.length === 1);
		await assert.rejects(readFile(join(fixture, "approved.txt")), {
			code: "ENOENT",
		});
		await session.receive({
			type: "permission/respond",
			requestId: "write-approve",
			sessionId: session.snapshot().sessionId,
			runId: session.snapshot().runId,
			permissionId: session.snapshot().permissions[0]!.id,
			optionId: "accept",
		});
		await until(() => session.snapshot().run !== "running");
		assert.equal(
			await readFile(join(fixture, "approved.txt"), "utf8"),
			"Host approved",
		);
		const savedId = session.snapshot().sessionId;
		assert.equal(
			await readFile(join(fixture, ".sessions", ".gitignore"), "utf8"),
			"*\n",
		);
		await session.connect();
		await session.receive({
			type: "session/list",
			requestId: "history-list",
		});
		assert.ok(
			session
				.snapshot()
				.sessions.some((row) => row.sessionId === savedId),
		);
		await session.receive({
			type: "session/load",
			requestId: "history-load",
			sessionId: savedId,
		});
		assert.equal(session.snapshot().sessionId, savedId);
		assert.equal(session.snapshot().tools.at(-1)?.status, "completed");
		assert.equal(session.snapshot().tools.at(-1)?.kind, "edit");
		assert.equal(session.snapshot().permissions.length, 0);
		await session.connect();
		await session.receive({
			type: "prompt/send",
			requestId: "tool-send",
			sessionId: session.snapshot().sessionId,
			text: "tool",
		});
		await until(() => session.snapshot().run !== "running");
		assert.equal(
			session.snapshot().run,
			"completed",
			session.snapshot().error ?? undefined,
		);
		assert.equal(session.snapshot().tools.at(-1)?.kind, "list");
		assert.equal(session.snapshot().tools.at(-1)?.status, "completed");
		assert.ok(
			JSON.stringify(session.snapshot().tools.at(-1)?.content).includes(
				"agent/",
			),
		);
		await session.receive({
			type: "prompt/send",
			requestId: "stop-send",
			sessionId: session.snapshot().sessionId,
			text: "stop",
		});
		await until(
			() => session.snapshot().messages.at(-1)?.streaming === true,
		);
		await session.receive({
			type: "prompt/cancel",
			requestId: "stop",
			sessionId: session.snapshot().sessionId,
			runId: session.snapshot().runId,
		});
		await until(() => session.snapshot().run === "cancelled");
	} finally {
		await controller?.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		assert.equal(dirname(fixture), tmpdir());
		assert.ok(basename(fixture).startsWith("nerita-pi-host-"));
		await rm(fixture, { recursive: true, force: true });
	}
}

/** 通知処理が完了するまで、期限付きで状態を待つ。 */
async function until(check: () => boolean): Promise<void> {
	const deadline = Date.now() + 10000;
	while (!check()) {
		assert.ok(Date.now() < deadline, "Pi Extension Host timeout");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}
