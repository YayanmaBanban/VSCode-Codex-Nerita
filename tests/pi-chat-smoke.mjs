// 実Pi SDKとローカルOpenAI互換サーバーで、通信・read・Stopを外部認証なしで検証する。
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { piPersistenceSmoke } from "./pi-persistence-smoke.mjs";
import { piPackagesSmoke } from "./pi-packages-smoke.mjs";

const projectRoot = process.cwd();
// 展開したVSIXも同じ疎通検証へ渡せるようにし、梱包漏れを検出する。
const extensionPath = path.resolve(process.argv[2] ?? projectRoot);
const fixture = await mkdtemp(path.join(tmpdir(), "nerita-pi-smoke-"));
const cwd = path.join(fixture, "workspace");
const agentDir = path.join(fixture, "agent");
const requests = [];
const errors = [];
let finishSteerResponse;
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
		if (prompt === "steer-start") {
			send({ content: "追加指示待ち" });
			finishSteerResponse = () => {
				send({}, "stop");
				response.end("data: [DONE]\n\n");
			};
			return;
		}
		const mutation = {
			write: {
				name: "write",
				args: { path: "approved.txt", content: "approved" },
			},
			edit: {
				name: "edit",
				args: {
					path: "approved.txt",
					edits: [{ oldText: "approved", newText: "edited" }],
				},
			},
			powershell: {
				name: "powershell",
				args: {
					command:
						"Set-Content -LiteralPath command.txt -Value executed; Write-Output 'command complete'",
				},
			},
			commandStop: {
				name: "powershell",
				args: {
					command:
						"Write-Output 'command started'; Start-Sleep -Seconds 30; Set-Content -LiteralPath unexpected.txt -Value bad",
				},
			},
		}[prompt];
		if (prompt === "stop") {
			send({ content: "停止待ち" });
			return;
		}
		if (
			(["tool", "list", "missing"].includes(prompt) || mutation) &&
			input.messages.at(-1)?.role !== "tool"
		) {
			send({
				tool_calls: [
					{
						index: 0,
						id: prompt === "list" ? "ls-smoke" : "read-smoke",
						type: "function",
						function: {
							name:
								mutation?.name ??
								(prompt === "list" ? "ls" : "read"),
							arguments: JSON.stringify(
								mutation?.args ?? {
									path: fixturePath(prompt),
								},
							),
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
		path.join(extensionPath, "dist/runtime"),
		path.join(fixture, "dist/runtime"),
		{
			recursive: true,
			filter: (source) => path.basename(source) !== "@openai",
		},
	);
	// ESMの公開入口と、遅延ロードされる画像変換用WASMも配布物だけで動かす。
	const sdk = await import(
		pathToFileURL(path.join(fixture, "dist/runtime/pi.mjs")).href
	);
	assert.equal(sdk.getPackageDir(), path.join(fixture, "dist/runtime/pi"));
	const png = await sdk.convertToPng(
		"R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
		"image/gif",
	);
	assert.ok(png, "配布した画像変換用WASMを読み込めませんでした。");
	assert.deepEqual(
		Buffer.from(png.data, "base64").subarray(0, 8),
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
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
		plugins: [
			{
				name: "vscode-smoke-boundary",
				/** VS Code外ではAPIを提供せず、未対応のエディター操作は失敗させる。 */
				setup(builder) {
					builder.onResolve({ filter: /^vscode$/ }, () => ({
						path: "vscode",
						namespace: "vscode-smoke-boundary",
					}));
					builder.onLoad(
						{ filter: /.*/, namespace: "vscode-smoke-boundary" },
						() => ({
							contents:
								"module.exports = { workspace: {}, window: {} };",
							loader: "js",
						}),
					);
				},
			},
		],
	});
	const { PiSessionController, createPiRuntime, isHostMessage } =
		createRequire(import.meta.url)(
			path.join(projectRoot, "dist/pi-smoke/host.cjs"),
		);
	controller = new PiSessionController(async (signal, authorize, resume) => ({
		cwd,
		session: await createPiRuntime({
			extensionPath: fixture,
			cwd,
			agentDir,
			signal,
			authorize,
			resume,
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
	// モデル応答を保持し、同じ実行中の追加指示が次のLLM呼出しへ入ることを確認する。
	await send("steer-start");
	await until(
		() => controller.snapshot().messages.at(-1)?.text === "追加指示待ち",
	);
	const steerRun = controller.snapshot().runId;
	await send("steer-next");
	await until(() =>
		events.some(
			(event) =>
				event.type === "prompt/accepted" &&
				event.requestId === `smoke-${sequence}` &&
				event.mode === "steer",
		),
	);
	assert.equal(controller.snapshot().runId, steerRun);
	assert.equal(controller.snapshot().run, "running");
	finishSteerResponse();
	await until(() => controller.snapshot().run === "completed");
	assert.ok(
		requests.some((request) =>
			JSON.stringify(request.messages.at(-1)?.content).includes(
				"steer-next",
			),
		),
	);
	assert.equal(
		controller
			.snapshot()
			.messages.filter(
				(message) =>
					message.role === "user" && message.text === "steer-next",
			).length,
		1,
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
				["read", "ls", "write", "edit", "powershell"].includes(
					tool.function.name,
				),
			),
		),
	);
	assert.equal(controller.snapshot().tools.at(-1).status, "completed");
	assert.equal(controller.snapshot().tools.at(-1).kind, "read");
	assert.ok(
		JSON.stringify(controller.snapshot().tools.at(-1).content).includes(
			"Pi read tool works",
		),
	);
	assert.ok(
		events.some(
			(event) =>
				event.type === "state/patch" &&
				event.patch.tools?.some(
					(tool) =>
						tool.kind === "read" && tool.status === "in_progress",
				),
		),
	);
	await send("list");
	await until(() => controller.snapshot().run !== "running");
	assert.equal(controller.snapshot().tools.at(-1).status, "completed");
	assert.equal(controller.snapshot().tools.at(-1).kind, "list");
	assert.ok(
		JSON.stringify(controller.snapshot().tools.at(-1).content).includes(
			"hello.txt",
		),
	);
	await send("missing");
	await until(() => controller.snapshot().run !== "running");
	assert.equal(controller.snapshot().tools.at(-1).status, "failed");
	assert.ok(
		JSON.stringify(controller.snapshot().tools.at(-1).content).includes(
			"ENOENT",
		),
	);
	assert.equal(controller.snapshot().tools.length, 3);
	// 拒否・承認待ちStopではSDKの副作用へ到達しない。
	const respond = (optionId) =>
		controller.receive({
			type: "permission/respond",
			requestId: `approval-${++sequence}`,
			sessionId: controller.snapshot().sessionId,
			runId: controller.snapshot().runId,
			permissionId: controller.snapshot().permissions[0].id,
			optionId,
		});
	for (const decision of ["decline", "cancel"]) {
		await send("write");
		await until(() => controller.snapshot().permissions.length === 1);
		await assert.rejects(readFile(path.join(cwd, "approved.txt")), {
			code: "ENOENT",
		});
		await respond(decision);
		await until(() =>
			["completed", "cancelled"].includes(controller.snapshot().run),
		);
		await assert.rejects(readFile(path.join(cwd, "approved.txt")), {
			code: "ENOENT",
		});
		assert.equal(controller.snapshot().permissions.length, 0);
	}
	for (const tool of ["write", "edit", "powershell"]) {
		const target = path.join(
			cwd,
			tool === "powershell" ? "command.txt" : "approved.txt",
		);
		const before = await readFile(target, "utf8").catch((error) => {
			assert.equal(error.code, "ENOENT");
			return null;
		});
		await send(tool);
		await until(() => controller.snapshot().permissions.length === 1);
		await respond("decline");
		await until(() => controller.snapshot().run !== "running");
		assert.equal(controller.snapshot().tools.at(-1).status, "failed");
		if (before === null) {
			await assert.rejects(readFile(target), { code: "ENOENT" });
		} else {
			assert.equal(await readFile(target, "utf8"), before);
		}
		await send(tool);
		await until(() => controller.snapshot().permissions.length === 1);
		assert.ok(controller.snapshot().permissions[0].title.includes(tool));
		await respond("accept");
		await until(() => controller.snapshot().run !== "running");
		assert.equal(
			controller.snapshot().tools.at(-1).status,
			"completed",
			JSON.stringify(controller.snapshot().tools.at(-1)),
		);
		assert.equal(
			(
				await readFile(
					path.join(
						cwd,
						tool === "powershell" ? "command.txt" : "approved.txt",
					),
					"utf8",
				)
			).trim(),
			expectedMutationText(tool),
		);
	}
	await send("commandStop");
	await until(() => controller.snapshot().permissions.length === 1);
	await respond("accept");
	await until(() =>
		JSON.stringify(controller.snapshot().tools.at(-1).content).includes(
			"command started",
		),
	);
	await controller.receive({
		type: "prompt/cancel",
		requestId: "command-stop",
		sessionId: controller.snapshot().sessionId,
		runId: controller.snapshot().runId,
	});
	await until(() => controller.snapshot().run === "cancelled");
	assert.equal(controller.snapshot().tools.at(-1).status, "cancelled");
	await assert.rejects(readFile(path.join(cwd, "unexpected.txt")), {
		code: "ENOENT",
	});
	await send("stop");
	await until(
		() => controller.snapshot().messages.at(-1)?.text === "停止待ち",
	);
	await send("cancelled-steer");
	await until(() =>
		events.some(
			(event) =>
				event.type === "prompt/accepted" &&
				event.requestId === `smoke-${sequence}` &&
				event.mode === "steer",
		),
	);
	await controller.receive({
		type: "prompt/cancel",
		requestId: "cancel",
		sessionId: controller.snapshot().sessionId,
		runId: controller.snapshot().runId,
	});
	await until(() => controller.snapshot().run === "cancelled");
	const requestCountBeforeResume = requests.length;
	await send("resume");
	await until(() => controller.snapshot().run !== "running");
	assert.equal(
		controller.snapshot().run,
		"completed",
		controller.snapshot().error,
	);
	assert.ok(
		requests
			.slice(requestCountBeforeResume)
			.every(
				(request) =>
					!JSON.stringify(request.messages).includes(
						"cancelled-steer",
					),
			),
	);
	assert.deepEqual(errors, []);
	await controller.dispose();
	controller = undefined;
	await piPersistenceSmoke({
		PiSessionController,
		createPiRuntime,
		sdk,
		extensionPath: fixture,
		cwd,
		agentDir,
		requests,
	});
	await piPackagesSmoke({
		PiSessionController,
		createPiRuntime,
		sdk,
		extensionPath: fixture,
		cwd,
		agentDir,
		requests,
	});
	console.log(
		"PASS: packaged Pi SDK + WASM → same-run steer → read/ls → write/edit/PowerShell approval and rejection → pending cancellation → command stop → queued steer cancellation → resume",
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

/** 一覧・存在しないファイル・通常読み取りの対象を選ぶ。 */
function fixturePath(prompt) {
	if (prompt === "list") {
		return ".";
	}
	if (prompt === "missing") {
		return "missing.txt";
	}
	return "hello.txt";
}

/** 承認した各操作で保存される検証用の本文を返す。 */
function expectedMutationText(tool) {
	if (tool === "write") {
		return "approved";
	}
	if (tool === "edit") {
		return "edited";
	}
	return "executed";
}
