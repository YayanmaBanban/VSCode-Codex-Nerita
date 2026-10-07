// 外部 App Server だけを子プロセスで代替し、本番のクライアント・通信・コントローラーを接続する。
import { z } from "zod";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { type RequestListener, type IncomingMessage } from "http";

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
import type { AttachmentService } from "../../apps/vscode-nerita/src/extension/session/attachmentService";
import type { CodexFactory } from "../../apps/vscode-nerita/src/extension/backends/codex/runtime/connection";
import type { InteractionService } from "../../apps/vscode-nerita/src/extension/backends/codex/interaction/interactionService";
import { parseRpcMessage } from "../../apps/vscode-nerita/src/extension/backends/codex/protocol/rpcMessage";
import { codexSelectionStore } from "../../apps/vscode-nerita/src/extension/backends/codex/settings/modelSelection";

/** 外部境界で受け取った JSON-RPC 要求。 */
export type Rpc = {
	id?: number;
	method: string;
	params?: Record<string, unknown>;
};

/** サーバー発の要求へ、本番のクライアントが JSONL で返した応答。 */
type ClientResponse = Extract<
	ReturnType<typeof parseRpcMessage>,
	{ kind: "response" }
>;

/** テスト側が指定した応答を、子プロセスの標準出力へ中継する。 */
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

/** Codex の製品バイナリや認証情報を使わず、通信先をテスト専用領域に用意する。 */
export async function codexFixture(t: TestContext) {
	assert.ok(isNonEmptyString(process.env.NERITA_TEST_ROOT));
	const root = await mkdtemp(join(process.env.NERITA_TEST_ROOT, "codex-"));
	const cwd = join(root, "workspace");
	await mkdir(cwd);
	const requests: Rpc[] = [];
	const clientResponses: ClientResponse[] = [];
	const responses = new Map<string, (message: Rpc) => unknown>();
	const streams: ServerResponse[] = [];
	const unexpected: string[] = [];
	const state = { authenticated: true, thread: 0, turn: 0, failSteer: false };
	const server = createServer(
		createCodexRelayHandler(
			streams,
			requests,
			cwd,
			state,
			unexpected,
			responses,
			clientResponses,
		),
	);
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	t.after(async () => {
		server.closeAllConnections();
		await closeCodexRelay(server);
		assert.deepEqual(unexpected, []);
	});
	const address = server.address();
	assert.ok(address !== null && typeof address !== "string");
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
	const factory = createCodexFactory(cwd, root);
	t.after(async () => {
		for (const controller of controllers) {
			await controller.dispose();
		}
	});
	return {
		state,
		requests,
		clientResponses,
		responses,
		cwd,
		extensionPath: root,
		factory,
		disconnect: () => {
			streams.at(-1)!.destroy();
		},
		...createCodexServerMessages(streams),
		controller: createCodexControllerFactory(
			factory,
			selectionPath,
			controllers,
		),
	};
}

/** 現在の接続へ通知とサーバー要求を送信し、再接続しても要求 ID を重複させない。 */
function createCodexServerMessages(streams: ServerResponse[]) {
	let requestId = 0;
	return {
		notify: (method: string, params: unknown) => {
			streams.at(-1)!.write(`${JSON.stringify({ method, params })}\n`);
		},
		serverRequest: (method: string, params: unknown) => {
			const id = ++requestId;
			streams
				.at(-1)!
				.write(`${JSON.stringify({ id, method, params })}\n`);
			return id;
		},
	};
}

/** 起動・取り消しの時点を制御するときも、接続と JSONL 通信は本番の実装を使う。 */
function createCodexFactory(cwd: string, root: string): CodexFactory {
	return async (callbacks, signal) => ({
		cwd,
		client: await CodexClient.connect({
			extensionPath: root,
			cwd,
			clientInfo: { title: null, name: "fixture", version: "1" },
			callbacks,
			signal,
		}),
	});
}

/** 接続生成を差し替えた場合も、一時領域の設定保存と終了時の回収を共用する。 */
function createCodexControllerFactory(
	defaultFactory: CodexFactory,
	selectionPath: string,
	controllers: CodexSessionController[],
) {
	return (
		auth?: AuthService,
		files?: AttachmentService,
		interactions?: InteractionService,
		factory: CodexFactory = defaultFactory,
	) => {
		const controller = new CodexSessionController(
			factory,
			files,
			auth,
			interactions,
			codexSelectionStore({
				read: async () => {
					try {
						return z
							.unknown()
							.parse(
								JSON.parse(
									await readFile(selectionPath, "utf8"),
								),
							);
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
	};
}

/** 子プロセスの JSONL 要求をローカル HTTP 境界へ中継する。 */
function createCodexRelayHandler(
	streams: ServerResponse<IncomingMessage>[],
	requests: Rpc[],
	cwd: string,
	state: {
		authenticated: boolean;
		thread: number;
		turn: number;
		failSteer: boolean;
	},
	unexpected: string[],
	responses: Map<string, (message: Rpc) => unknown>,
	clientResponses: ClientResponse[],
): RequestListener<typeof IncomingMessage, typeof ServerResponse> | undefined {
	return (request, response) => {
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
			const parsed = parseRpcMessage(z.unknown().parse(JSON.parse(body)));
			if (parsed.kind === "response") {
				clientResponses.push(parsed);
				response.end();
				return;
			}
			const message = z
				.object({
					method: z.string(),
					id: z.number().optional(),
					params: z.record(z.string(), z.unknown()).optional(),
				})
				.transform(({ method, id, params }): Rpc => ({
					method,
					...(id === undefined ? {} : { id }),
					...(params === undefined ? {} : { params }),
				}))
				.parse(
					parsed.kind === "request"
						? parsed.request
						: parsed.notification,
				);
			requests.push(message);
			if (message.id === undefined) {
				response.end();
				return;
			}
			try {
				const custom = responses.get(message.method);
				const result = custom
					? custom(message)
					: reply(message, cwd, state);
				void sendCodexResponse(
					response,
					message,
					result,
					unexpected,
					state.failSteer && message.method === "turn/steer",
				);
			} catch {
				sendCodexFailure(
					response,
					message,
					unexpected,
					state.failSteer && message.method === "turn/steer",
				);
			}
		});
	};
}

/** 遅延応答も本番の JSONL 経路へ返し、非同期の失敗を準備失敗として記録する。 */
async function sendCodexResponse(
	response: ServerResponse,
	message: Rpc,
	answer: unknown,
	unexpected: string[],
	expectedFailure: boolean,
) {
	try {
		const result = await answer;
		response.end(`${JSON.stringify({ id: message.id, result })}\n`);
	} catch {
		sendCodexFailure(response, message, unexpected, expectedFailure);
	}
}

/** 指定した失敗以外を後片付け時の失敗にし、RPC にも失敗応答を返す。 */
function sendCodexFailure(
	response: ServerResponse,
	message: Rpc,
	unexpected: string[],
	expectedFailure: boolean,
) {
	if (!expectedFailure) {
		unexpected.push(message.method);
	}
	response.end(
		`${JSON.stringify({ id: message.id, error: { code: -32000, message: "fixture failure" } })}\n`,
	);
}

/** 外部 RPC 応答の返却時点をシナリオ側で指定し、通知と応答の順を検証する。 */
export function codexResponseGate() {
	let release: ((value: unknown) => void) | undefined;
	const response = new Promise<unknown>((resolve) => {
		release = resolve;
	});
	assert.ok(release);
	return { response, release };
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

/** 接続を閉じた後、サーバーの終了通知を待つ。 */
function closeCodexRelay(server: ReturnType<typeof createServer>) {
	return new Promise<void>((resolve) => server.close(() => resolve()));
}
