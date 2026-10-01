// 外部 App Server だけを子プロセスで代替し、本番 Client・通信・Controller を接続する。
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { CodexClient } from "../../apps/vscode-nerita/src/extension/backends/codex/CodexClient";
import { CodexSessionController } from "../../apps/vscode-nerita/src/extension/backends/codex/CodexSessionController";
import type { AuthService } from "../../apps/vscode-nerita/src/extension/backends/codex/interaction/AuthFlow";
import { codexSelectionStore } from "../../apps/vscode-nerita/src/extension/backends/codex/settings/modelSelection";

/** 外部境界で受け取った JSON-RPC 要求。 */
export type Rpc = {
	id?: number;
	method: string;
	params?: Record<string, unknown>;
};

/** テスト側が指定した応答を、実プロセスの標準出力へ運ぶだけの中継器。 */
const relay = `
const fs = require('node:fs');
const readline = require('node:readline');
const url = fs.readFileSync('control-url', 'utf8');
void (async () => {
 const events = await fetch(url + '/events');
 for await (const chunk of events.body) process.stdout.write(Buffer.from(chunk));
})();
readline.createInterface({ input: process.stdin }).on('line', async line => {
 const response = await fetch(url, { method: 'POST', body: line });
 process.stdout.write(await response.text());
});
`;

/** 固定した実製品版や認証情報を使わず、通信先だけを専用領域へ閉じ込める。 */
export async function codexFixture(t: TestContext) {
	assert.ok(process.env.NERITA_TEST_ROOT);
	const root = await mkdtemp(join(process.env.NERITA_TEST_ROOT, "codex-"));
	const cwd = join(root, "workspace");
	await mkdir(cwd);
	const requests: Rpc[] = [];
	const streams: ServerResponse[] = [];
	const unexpected: string[] = [];
	const state = { authenticated: true, thread: 0, turn: 0, failSteer: false };
	const server = createServer((request, response) => {
		if (request.url === "/events") {
			streams.push(response);
			response.writeHead(200, { "content-type": "text/plain" });
			response.flushHeaders();
			return;
		}
		let body = "";
		request.setEncoding("utf8");
		request.on("data", (chunk: string) => {
			body += chunk;
		});
		request.on("end", () => {
			const message = JSON.parse(body) as Rpc;
			requests.push(message);
			if (message.id === undefined) {
				response.end();
				return;
			}
			try {
				const result = reply(message, cwd, state);
				response.end(`${JSON.stringify({ id: message.id, result })}\n`);
			} catch {
				if (!(state.failSteer && message.method === "turn/steer")) {
					unexpected.push(message.method);
				}
				response.end(
					`${JSON.stringify({
						id: message.id,
						error: { code: -32000, message: "fixture failure" },
					})}\n`,
				);
			}
		});
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	t.after(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		assert.deepEqual(unexpected, []);
	});
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	await writeFile(
		join(cwd, "control-url"),
		`http://127.0.0.1:${address.port}`,
	);
	await writeFile(join(cwd, "app-server"), relay);
	const executableRoot = join(root, "dist/runtime/node_modules/@openai");
	const bin = join(
		executableRoot,
		"codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin",
	);
	await mkdir(bin, { recursive: true });
	await mkdir(join(executableRoot, "codex"));
	await copyFile(process.execPath, join(bin, "codex.exe"));
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({ dependencies: { "@openai/codex": "fixture" } }),
	);
	await writeFile(
		join(executableRoot, "codex/package.json"),
		JSON.stringify({ version: "fixture" }),
	);
	const selectionPath = join(root, "selection.json");
	const controllers: CodexSessionController[] = [];
	t.after(async () => {
		for (const controller of controllers) {
			await controller.dispose();
		}
	});
	return {
		state,
		requests,
		cwd,
		extensionPath: root,
		disconnect: () => {
			streams.at(-1)!.destroy();
		},
		notify: (method: string, params: unknown) => {
			streams.at(-1)!.write(`${JSON.stringify({ method, params })}\n`);
		},
		controller: (auth?: AuthService) => {
			const controller = new CodexSessionController(
				async (callbacks, signal) => ({
					cwd,
					client: await CodexClient.connect({
						extensionPath: root,
						cwd,
						clientInfo: {
							title: null,
							name: "fixture",
							version: "1",
						},
						callbacks,
						signal,
					}),
				}),
				undefined,
				auth,
				undefined,
				codexSelectionStore({
					read: async () => {
						try {
							return JSON.parse(
								await readFile(selectionPath, "utf8"),
							) as unknown;
						} catch {
							return undefined;
						}
					},
					write: async (value) => {
						await writeFile(selectionPath, JSON.stringify(value));
					},
				}),
			);
			controllers.push(controller);
			return controller;
		},
	};
}

/** 応答は公開プロトコルの最小データに限定し、画面状態を生成しない。 */
function reply(
	message: Rpc,
	cwd: string,
	state: {
		authenticated: boolean;
		thread: number;
		turn: number;
		failSteer: boolean;
	},
): unknown {
	const fixed: Record<string, unknown> = {
		"config/read": { config: { windows: { sandbox: "elevated" } } },
		"windowsSandbox/setupStart": { started: true },
		"skills/list": { data: [] },
		"thread/list": { data: [], nextCursor: null },
		"account/rateLimits/read": { rateLimits: {} },
		"turn/interrupt": {},
		"account/login/start": {
			type: "chatgpt",
			loginId: "login-1",
			authUrl: "https://auth.openai.com/fixture",
		},
		"account/login/cancel": { status: "canceled" },
	};
	if (Object.hasOwn(fixed, message.method)) {
		return fixed[message.method];
	}
	switch (message.method) {
		case "initialize":
			return {
				userAgent: "fixture",
				codexHome: cwd,
				platformFamily: "windows",
				platformOs: "windows",
			};
		case "account/read":
			return {
				account: state.authenticated ? { type: "apiKey" } : null,
				requiresOpenaiAuth: true,
			};
		case "thread/start":
			return {
				thread: { id: `thread-${++state.thread}` },
				model: "model-a",
				cwd,
				reasoningEffort: "low",
			};
		case "model/list":
			return {
				nextCursor: null,
				data: ["model-a", "model-b"].map((model) => ({
					model,
					displayName: model,
					defaultReasoningEffort: "low",
					supportedReasoningEfforts: ["low", "high"].map(
						(reasoningEffort) => ({
							reasoningEffort,
							description: reasoningEffort,
						}),
					),
					inputModalities: ["text"],
					serviceTiers: [],
				})),
			};
		case "turn/start":
			return {
				turn: { id: `turn-${++state.turn}`, status: "inProgress" },
			};
		case "turn/steer":
			if (state.failSteer) {
				throw new Error("受付不明");
			}
			return { turnId: message.params!.expectedTurnId };
		default:
			throw new Error(`予定外の RPC: ${message.method}`);
	}
}
