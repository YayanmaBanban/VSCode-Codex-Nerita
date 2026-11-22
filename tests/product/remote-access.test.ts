// ループバック HTTP から、実際の Pi SDK と Codex JSONL へ操作を届ける。
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	remoteFilesReplySchema,
	type RemoteFilesRequest,
} from "@nerita/shared/remote/files";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, Socket } from "node:net";
import { request, IncomingMessage, ServerResponse } from "node:http";
import { json } from "node:stream/consumers";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import * as vscode from "vscode";
import {
	remoteBootstrapSchema,
	remoteErrorSchema,
	remoteStateBytes,
	remoteStateSchema,
	remoteTextLimit,
	type RemoteAction,
	type RemoteChatState,
	type RemoteErrorCode,
} from "@nerita/shared/remote/contracts";
import type { BackendId } from "@nerita/shared/backend";
import { initialState, type ChatState } from "@nerita/shared/chatState";
import { BackendRuntime } from "../../apps/vscode-nerita/src/extension/session/BackendRuntime";
import { BackendSelection } from "../../apps/vscode-nerita/src/extension/backends/BackendSelection";
import { RemoteChatAdapter } from "../../apps/vscode-nerita/src/extension/remote/RemoteChatAdapter";
import { RemoteAuth } from "../../apps/vscode-nerita/src/extension/remote/RemoteAuth";
import { RemoteHttpServer } from "../../apps/vscode-nerita/src/extension/remote/RemoteHttpServer";
import { RemoteEvents } from "../../apps/vscode-nerita/src/extension/remote/RemoteEvents";
import type { ChatSession } from "../../apps/vscode-nerita/src/extension/session/chatSession";
import { piFixture, until } from "../support/pi";
import { codexFixture, codexResponseGate } from "../support/codex";

const host = "pc.example.ts.net";
const proxy = {
	Host: host,
	"X-Forwarded-Host": host,
	"X-Forwarded-Proto": "https",
};

/** 設定保存を保留し、切替ロックを取得した後に競合要求を到着させる。 */
function settings(initial: BackendId = "pi") {
	let backend = initial;
	const gate = codexResponseGate();
	let saving = false;
	Object.assign(vscode.workspace, {
		getConfiguration: () => ({
			get: () => backend,
			inspect: () => ({ workspaceValue: backend }),
			update: async (_key: string, value: BackendId, scope: number) => {
				assert.equal(scope, 2);
				saving = true;
				await gate.response;
				backend = value;
			},
		}),
	});
	Object.assign(vscode.ConfigurationTarget, { Global: 1, Workspace: 2 });
	return {
		current: () => backend,
		saving: () => saving,
		finish: () => gate.release(null),
	};
}

/** Node の Fetch が書き換える Host を保持し、Serve の転送を再現する。 */
async function remoteRequest(
	url: string,
	options: {
		method?: string;
		headers?: Record<string, string>;
		body?: string;
		signal?: AbortSignal;
	} = {},
): Promise<{
	status: number;
	headers: Headers;
	body: IncomingMessage;
	json: () => Promise<unknown>;
}> {
	// 画面操作より速い連続要求で、全体の試行制限に触れないようにする。
	await delay(40);
	return new Promise((resolve, reject) => {
		const req = request(url, { ...options, agent: false }, (incoming) => {
			const headers = new Headers();
			for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
				headers.append(
					incoming.rawHeaders[i]!,
					incoming.rawHeaders[i + 1]!,
				);
			}
			resolve({
				status: incoming.statusCode ?? 500,
				headers,
				body: incoming,
				json: () => json(incoming),
			});
		});
		req.on("error", reject);
		req.end(options.body);
	});
}

/** 固定で使う本番ポートを占有せず、実際の TCP で失敗・成功を検証する。 */
async function availablePort() {
	const server = createServer().listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address !== null && typeof address !== "string");
	server.close();
	await once(server, "close");
	return address.port;
}

/** Serve が付けるヘッダーをテストの通信だけに適用する。 */
async function startRemote(
	t: TestContext,
	root: string,
	chat: RemoteChatAdapter,
	notifications?: ConstructorParameters<typeof RemoteHttpServer>[2],
) {
	const directory = join(root, "remote-assets");
	await mkdir(directory);
	await Promise.all(
		["index.html", "index.js", "index.css"].map((name) =>
			writeFile(join(directory, name), name),
		),
	);
	const port = await availablePort();
	const server = new RemoteHttpServer(host, chat, notifications);
	t.after(() => server.stop());
	await assert.rejects(remoteRequest(`http://127.0.0.1:${port}/`));
	await server.start(directory, port);
	return { server, url: `http://127.0.0.1:${port}` };
}

/** 同じ Cookie と CSRF トークンで再接続やリプレイを検証する。 */
async function remoteClient(url: string, server: RemoteHttpServer) {
	const response = await remoteRequest(`${url}/api/v1/pair`, {
		method: "POST",
		headers: {
			...proxy,
			Origin: `https://${host}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ code: server.issueCode() }),
	});
	assert.equal(response.status, 200);
	const cookie = response.headers.get("Set-Cookie");
	assert.ok(cookie !== null);
	assert.match(
		cookie,
		/HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=43200/u,
	);
	const headers = { ...proxy, Cookie: cookie.split(";")[0]! };
	const snapshot = async () => {
		const result = await remoteRequest(`${url}/api/v1/bootstrap`, {
			headers,
		});
		assert.equal(result.status, 200);
		return remoteBootstrapSchema.parse(await result.json());
	};
	const { csrf } = await snapshot();
	return {
		headers,
		snapshot,
		workspace: (operation: RemoteFilesRequest) =>
			remoteRequest(`${url}/api/v1/workspace`, {
				method: "POST",
				body: JSON.stringify(operation),
				headers: {
					...headers,
					Origin: `https://${host}`,
					"Content-Type": "application/json",
					"X-Nerita-CSRF": csrf,
				},
			}),
		send: async (
			action: RemoteAction | object,
			override?: Record<string, string>,
		) =>
			remoteRequest(`${url}/api/v1/actions`, {
				method: "POST",
				body: JSON.stringify(action),
				headers: {
					...headers,
					Origin: `https://${host}`,
					"Content-Type": "application/json",
					"X-Nerita-CSRF": csrf,
					...override,
				},
			}),
	};
}

/** Keep-alive のストリームから先頭イベントだけを読み、接続を閉じても実行を継続させる。 */
async function firstEvent(url: string, headers: Record<string, string>) {
	const response = await remoteRequest(`${url}/api/v1/events`, {
		headers,
		signal: AbortSignal.timeout(5000),
	});
	assert.equal(response.status, 200);
	assert.equal(
		response.headers.get("cache-control"),
		"no-store, no-transform",
	);
	const decoder = new TextDecoder();
	let text = "";
	try {
		for await (const chunk of response.body) {
			assert.ok(Buffer.isBuffer(chunk));
			text += decoder.decode(chunk, { stream: true });
			if (text.includes("\n\n")) {
				break;
			}
		}
		const data = text.split("\n").find((line) => line.startsWith("data: "));
		assert.ok(data !== undefined);
		return remoteStateSchema.parse(JSON.parse(data.slice(6)));
	} finally {
		response.body.destroy();
	}
}

/** 現在の操作対象をそのまま送る。 */
function prompt(state: RemoteChatState, text: string): RemoteAction {
	assert.ok(state.sessionId !== null);
	return {
		type: "prompt.send",
		requestId: randomUUID(),
		sessionId: state.sessionId,
		backendGeneration: state.backendGeneration,
		text,
	};
}

/** 表示された実行 ID と承認 ID から操作を作る。 */
function approval(
	state: RemoteChatState,
	optionId: string,
): Extract<RemoteAction, { type: "approval.respond" }> {
	assert.ok(state.sessionId !== null && state.runId !== null);
	assert.ok(state.pendingApprovals[0] !== undefined);
	return {
		type: "approval.respond",
		requestId: randomUUID(),
		sessionId: state.sessionId,
		runId: state.runId,
		permissionId: state.pendingApprovals[0].id,
		optionId,
		backendGeneration: state.backendGeneration,
	};
}

/** 表示された現在の実行にだけ停止を送る。 */
function stop(
	state: RemoteChatState,
): Extract<RemoteAction, { type: "run.stop" }> {
	assert.ok(state.sessionId !== null && state.runId !== null);
	return {
		type: "run.stop",
		requestId: randomUUID(),
		sessionId: state.sessionId,
		runId: state.runId,
		backendGeneration: state.backendGeneration,
	};
}

type Client = Awaited<ReturnType<typeof remoteClient>>;

/** VS Code と実行ルートの信頼をそれぞれ取り消せるテスト入力。 */
type Trust = { workspace: boolean; root: boolean };

/** エラーの分類まで照合し、別の理由による拒否でテストが通らないようにする。 */
async function expectRejected(
	client: Client,
	action: RemoteAction,
	status: number,
	code: RemoteErrorCode,
) {
	const response = await client.send(action);
	assert.equal(response.status, status);
	assert.equal(
		remoteErrorSchema.parse(await response.json()).error.code,
		code,
	);
}

/** 片方の信頼が欠けるだけで送信・承認のそれぞれが拒否されることを確認する。 */
async function verifyUntrusted(
	client: Client,
	action: RemoteAction,
	trust: Trust,
) {
	for (const target of ["workspace", "root"] as const) {
		trust[target] = false;
		try {
			await expectRejected(
				client,
				{ ...action, requestId: randomUUID() },
				403,
				"forbidden",
			);
		} finally {
			trust[target] = true;
		}
	}
}

/** 承認待ちに拒否された要求と、バックエンド再生成後に届く旧世代の要求を照合する。 */
function authorizationProbe(client: Client, trust: Trust) {
	let captured: RemoteChatState | undefined;
	return {
		/** 実際に承認待ちの会話から、有効な実行と承認の ID を保持する。 */
		async inspect(this: void, state: RemoteChatState) {
			captured = state;
			const action = stop(state);
			await expectRejected(
				client,
				{ ...action, sessionId: randomUUID() },
				409,
				"stale_session",
			);
			await expectRejected(
				client,
				{ ...action, requestId: randomUUID(), runId: randomUUID() },
				409,
				"stale_run",
			);
			await verifyUntrusted(client, approval(state, "accept"), trust);
		},
		/** 現在の会話へ配送される前に、旧世代の三操作を拒否する。 */
		async verifyRetired() {
			assert.ok(captured !== undefined);
			for (const action of [
				prompt(captured, "古い会話"),
				stop(captured),
				approval(captured, "accept"),
			]) {
				await expectRejected(client, action, 409, "stale_backend");
			}
		},
	};
}

/** PC の拒否とネットワーク越しの許可が競合したとき、後着の要求を拒否する。 */
async function pcApprovalWins(
	chat: ChatSession,
	client: Client,
	state: RemoteChatState,
) {
	const action = approval(state, "accept");
	const mobile = client.send(action);
	await chat.receive({
		type: "permission/respond",
		requestId: randomUUID(),
		sessionId: action.sessionId,
		runId: action.runId,
		permissionId: action.permissionId,
		optionId: "decline",
	});
	assert.equal((await mobile).status, 409);
}

/** 承認待ちの実行を交換せず、リモートの切替を拒否する。 */
async function rejectBusySwitch(client: Client, state: RemoteChatState) {
	assert.equal(
		(
			await client.send({
				type: "backend.select",
				requestId: randomUUID(),
				backend: state.backend === "pi" ? "codex" : "pi",
				expectedBackend: state.backend,
				backendGeneration: state.backendGeneration,
			})
		).status,
		409,
	);
}

/** セッションを取得する前の到達制限と認証済みの操作境界を照合する。 */
async function verifyHttpBoundary(url: string, client: Client) {
	const unauthenticated = await remoteRequest(`${url}/api/v1/bootstrap`, {
		headers: proxy,
	});
	assert.equal(unauthenticated.status, 401);
	const invalidCookie = await remoteRequest(`${url}/api/v1/bootstrap`, {
		headers: { ...proxy, Cookie: "__Host-nerita=invalid" },
	});
	assert.equal(invalidCookie.status, 401);
	assert.equal((await remoteRequest(url)).status, 403);
	assert.equal(
		(
			await remoteRequest(url, {
				headers: { ...proxy, "Tailscale-Funnel-Request": "?1" },
			})
		).status,
		403,
	);
	assert.equal(
		(await remoteRequest(`${url}/%2e%2e%2findex.js`, { headers: proxy }))
			.status,
		404,
	);
	const ui = await remoteRequest(url, { headers: proxy });
	assert.equal(ui.status, 200);
	assert.match(
		ui.headers.get("content-security-policy") ?? "",
		/default-src 'none'/u,
	);
	assert.equal((await client.send({ type: "auth/logout" })).status, 400);
	assert.equal(
		(await client.send({}, { Origin: "https://other.example" })).status,
		403,
	);
	assert.equal(
		(await client.send({}, { "X-Nerita-CSRF": "wrong" })).status,
		403,
	);
	assert.equal(
		(await client.send({ oversized: "x".repeat(32768) })).status,
		413,
	);
}

/** Pi の実ツールで許可・拒否・Stop の副作用を確認する。 */
async function exercisePi(
	runtime: BackendRuntime,
	fixture: Awaited<ReturnType<typeof piFixture>>,
	client: Client,
	url: string,
	inspect: (state: RemoteChatState) => Promise<void>,
) {
	const session = runtime.scope("chat");
	for (const decision of ["accept", "decline", "pc", "stop"]) {
		const path = `${decision}.txt`;
		fixture.model.replies.push(
			{ name: "write", arguments: { path, content: "fixture secret" } },
			"処理しました",
		);
		const start = prompt(
			(await client.snapshot()).state,
			`ファイルを作成 ${decision}`,
		);
		assert.equal((await client.send(start)).status, 200);
		assert.equal((await client.send(start)).status, 409);
		await until(
			() => session.snapshot().permissions.length > 0,
			() => ({
				run: session.snapshot().run,
				pending: session.snapshot().permissions.length,
			}),
		);
		const waiting = await firstEvent(url, client.headers);
		if (decision === "accept") {
			await inspect(waiting);
		}
		await rejectBusySwitch(client, waiting);
		assert.equal(waiting.backend, "pi");
		assert.equal(
			waiting.pendingApprovals[0]?.title,
			"Pi: write の実行承認",
		);
		assert.ok(!JSON.stringify(waiting).includes("fixture secret"));
		await assert.rejects(readFile(join(fixture.cwd, path)), {
			code: "ENOENT",
		});
		assert.equal(
			(await client.send(approval(waiting, "accept-workspace"))).status,
			403,
		);
		const optionId = decision === "pc" ? "accept" : decision;
		const action =
			decision === "stop" ? stop(waiting) : approval(waiting, optionId);
		if (decision === "pc") {
			await pcApprovalWins(session, client, waiting);
		} else {
			assert.equal((await client.send(action)).status, 200);
		}
		await until(() =>
			["completed", "cancelled", "failed"].includes(
				session.snapshot().run,
			),
		);
		if (decision === "accept") {
			assert.equal(
				await readFile(join(fixture.cwd, path), "utf8"),
				"fixture secret",
			);
		} else {
			await assert.rejects(readFile(join(fixture.cwd, path)), {
				code: "ENOENT",
			});
		}
		assert.equal(
			(await client.send({ ...action, requestId: randomUUID() })).status,
			409,
		);
	}
}

/** Codex の実 JSONL 経路で承認と実行中断が一度だけ届くことを確かめる。 */
async function exerciseCodex(
	runtime: BackendRuntime,
	fixture: Awaited<ReturnType<typeof codexFixture>>,
	client: Client,
	url: string,
	inspect: (state: RemoteChatState) => Promise<void>,
) {
	const chat = runtime.scope("chat");
	const initial = (await client.snapshot()).state;
	assert.equal(initial.backend, "codex");
	assert.equal(
		(await client.send(prompt(initial, "変更を確認"))).status,
		200,
	);
	const run = chat.snapshot();
	const turnId = "turn-1";
	fixture.notify("turn/started", {
		threadId: run.sessionId,
		turn: { id: turnId, status: "inProgress", items: [] },
	});
	for (const decision of ["accept", "decline", "pc"]) {
		const id = fixture.serverRequest(
			"item/commandExecution/requestApproval",
			{
				threadId: run.sessionId,
				turnId,
				itemId: decision,
				command: "fixture secret",
				cwd: fixture.cwd,
				reason: "コマンドの確認",
			},
		);
		await until(
			() => chat.snapshot().permissions.length === 1,
			() => ({
				run: chat.snapshot().run,
				responses: fixture.clientResponses,
			}),
		);
		const state = await firstEvent(url, client.headers);
		if (decision === "accept") {
			await inspect(state);
		}
		await rejectBusySwitch(client, state);
		assert.ok(!JSON.stringify(state).includes("fixture secret"));
		const action = approval(state, decision === "pc" ? "accept" : decision);
		if (decision === "pc") {
			await pcApprovalWins(chat, client, state);
		} else {
			assert.equal((await client.send(action)).status, 200);
		}
		await until(
			() => fixture.clientResponses.some((entry) => entry.id === id),
			() => ({ missingApprovalResponse: id }),
		);
		assert.deepEqual(
			fixture.clientResponses.find((entry) => entry.id === id)?.result,
			{ decision: decision === "pc" ? "decline" : decision },
		);
		assert.equal(
			(await client.send({ ...action, requestId: randomUUID() })).status,
			409,
		);
	}
	await verifyCodexStop(chat, fixture, client, run.sessionId, turnId);
}

/** App Server の停止応答に続くターン終了で、初めて停止済みになることを確認する。 */
async function verifyCodexStop(
	chat: ChatSession,
	fixture: Awaited<ReturnType<typeof codexFixture>>,
	client: Client,
	threadId: string | null,
	turnId: string,
) {
	assert.equal(
		(await client.send(stop((await client.snapshot()).state))).status,
		200,
	);
	await until(
		() =>
			fixture.requests.some(
				(request) => request.method === "turn/interrupt",
			),
		() => ({ missingInterrupt: true, run: chat.snapshot().run }),
	);
	fixture.notify("turn/completed", {
		threadId,
		turn: { id: turnId, status: "interrupted", items: [] },
	});
	await until(
		() => chat.snapshot().run === "cancelled",
		() => ({
			finalRun: chat.snapshot().run,
			error: chat.snapshot().error,
			threadId,
			turnId,
		}),
	);
}

void test("Pi と Codex で認証済み HTTP 操作、SSE 再購読、承認、停止、切替を共有する", async (t) => {
	const pi = await piFixture(t);
	const codex = await codexFixture(t);
	const config = settings();
	const runtime = new BackendRuntime(
		(backend) =>
			backend === "codex" ? codex.controller() : pi.controller(),
		undefined,
		undefined,
		config.current,
	);
	t.after(() => runtime.dispose());
	const chat = runtime.scope("chat");
	await chat.receive({ type: "connection/retry", requestId: randomUUID() });
	assert.equal(
		chat.snapshot().connection,
		"ready",
		chat.snapshot().error ?? "",
	);
	const selection = new BackendSelection(runtime);
	const trust = { workspace: true, root: true };
	const adapter = new RemoteChatAdapter(
		chat,
		selection,
		() => trust.workspace,
		() => Promise.resolve(trust.root),
		() => 0,
	);
	const { server, url } = await startRemote(t, pi.root, adapter);
	const client = await remoteClient(url, server);
	await verifyHttpBoundary(url, client);
	const before = (await client.snapshot()).state;
	await verifyUntrusted(client, prompt(before, "未信頼の送信"), trust);
	assert.equal((await client.send(prompt(before, "/logout"))).status, 403);
	const piAuthorization = authorizationProbe(client, trust);
	await exercisePi(runtime, pi, client, url, piAuthorization.inspect);
	const select = {
		type: "backend.select",
		requestId: randomUUID(),
		backend: "codex",
		expectedBackend: "pi",
		backendGeneration: before.backendGeneration,
	} as const;
	const switching = client.send(select);
	await until(config.saving);
	assert.equal(await selection.select("codex"), "busy");
	config.finish();
	assert.equal((await switching).status, 200);
	await piAuthorization.verifyRetired();
	const codexAuthorization = authorizationProbe(client, trust);
	await exerciseCodex(
		runtime,
		codex,
		client,
		url,
		codexAuthorization.inspect,
	);
	const current = (await client.snapshot()).state;
	assert.ok(current.backendGeneration > before.backendGeneration);
	assert.equal(
		(
			await client.send({
				...select,
				requestId: randomUUID(),
				backend: "pi",
				expectedBackend: "codex",
				backendGeneration: current.backendGeneration,
			})
		).status,
		200,
	);
	assert.equal((await client.snapshot()).state.backend, "pi");
	await codexAuthorization.verifyRetired();
	await verifyRevocation(server, url, client);
});

/** PC での端末解除が、既存 Cookie での状態取得にも反映されることを確認する。 */
async function verifyRevocation(
	server: RemoteHttpServer,
	url: string,
	client: Client,
) {
	server.revoke();
	assert.equal(
		(
			await remoteRequest(`${url}/api/v1/bootstrap`, {
				headers: client.headers,
			})
		).status,
		401,
	);
}

void test("PC の初期バックエンドを引き継ぎ、認証と端末の接続状態を PC へ通知する", async (t) => {
	const fixture = await codexFixture(t);
	const config = settings("codex");
	const runtime = new BackendRuntime(
		() => fixture.controller(),
		undefined,
		undefined,
		config.current,
	);
	t.after(() => runtime.dispose());
	const chat = runtime.scope("chat");
	await chat.receive({ type: "connection/retry", requestId: randomUUID() });
	const adapter = new RemoteChatAdapter(
		chat,
		new BackendSelection(runtime),
		() => true,
		() => Promise.resolve(true),
		() => 0,
	);
	let paired = 0;
	let connectionChanges = 0;
	const { server, url } = await startRemote(
		t,
		fixture.extensionPath,
		adapter,
		{
			onPaired: () => {
				paired++;
			},
			onConnectionChange: () => {
				connectionChanges++;
			},
		},
	);
	const client = await remoteClient(url, server);
	assert.equal(paired, 1);
	assert.equal(server.connected(), false);
	assert.equal((await client.snapshot()).state.backend, "codex");
	assert.equal((await firstEvent(url, client.headers)).backend, "codex");
	await until(() => connectionChanges === 2);
	assert.equal(server.connected(), false);
	assert.equal(paired, 1);
	server.stop();
	await assert.rejects(remoteRequest(url));
});

void test("PC の Pi セッションを引き継ぎ、履歴を復元し、同じ作業ツリーからコミットとプッシュを行う", async (t) => {
	const fixture = await piFixture(t);
	const config = settings();
	const runtime = new BackendRuntime(
		() => fixture.controller(),
		undefined,
		undefined,
		config.current,
	);
	t.after(() => runtime.dispose());
	const chat = runtime.scope("chat");
	await chat.receive({ type: "connection/retry", requestId: randomUUID() });
	const { sessionId } = chat.snapshot();
	assert.ok(sessionId !== null);
	fixture.model.replies.push("PC から送信済みの応答");
	await chat.receive({
		type: "prompt/send",
		requestId: randomUUID(),
		text: "PC から送信した内容",
		sessionId,
	});
	await until(() => chat.snapshot().run === "completed");
	const adapter = new RemoteChatAdapter(
		chat,
		new BackendSelection(runtime),
		() => true,
		() => Promise.resolve(true),
		() => 0,
	);
	const { server, url } = await startRemote(t, fixture.root, adapter);
	const client = await remoteClient(url, server);
	const attached = (await client.snapshot()).state;
	assert.equal(attached.sessionId, sessionId);
	assert.equal(attached.messages.at(-1)?.text, "PC から送信済みの応答");
	await verifyRemoteGit(client, attached, fixture);
	await verifyRemoteSessionHistory(client, attached);
});

const runGit = promisify(execFile);

/** 実ネットワークを使用せず、専用 bare リポジトリで Git の結果を確認する。 */
async function verifyRemoteGit(
	client: Client,
	state: RemoteChatState,
	fixture: Awaited<ReturnType<typeof piFixture>>,
) {
	const localGit = async (...args: string[]) =>
		(await runGit("git", args, { cwd: fixture.cwd })).stdout.trim();
	const upstream = join(fixture.root, "upstream.git");
	await localGit("init", "--bare", upstream);
	await localGit("init", "-b", "test");
	await localGit("config", "user.name", "Remote test");
	await localGit("config", "user.email", "remote@example.invalid");
	await localGit("commit", "--allow-empty", "-m", "initial");
	await localGit("remote", "add", "origin", upstream);
	await localGit("push", "-u", "origin", "test");
	const file = "change space.txt";
	await writeFile(join(fixture.cwd, file), "remote preview\n");
	assert.ok(state.sessionId !== null);
	const target = {
		sessionId: state.sessionId,
		backendGeneration: state.backendGeneration,
	};
	const list = () =>
		client.workspace({ type: "list", requestId: randomUUID(), ...target });
	const before = remoteFilesReplySchema.parse(await (await list()).json());
	assert.equal(before.type, "list");
	assert.ok(before.files.some(({ path }) => path === file));
	const open = await client.workspace({
		type: "read",
		path: file,
		requestId: randomUUID(),
		...target,
	});
	assert.deepEqual(remoteFilesReplySchema.parse(await open.json()), {
		type: "file",
		text: "remote preview\n",
		path: file,
	});
	const stage = await client.workspace({
		type: "stage",
		path: file,
		requestId: randomUUID(),
		...target,
	});
	assert.equal(stage.status, 200);
	assert.equal(await localGit("diff", "--cached", "--name-only"), file);
	const staged = remoteFilesReplySchema.parse(await (await list()).json());
	assert.equal(staged.type, "list");
	assert.ok(staged.index !== null);
	const commit = await client.workspace({
		type: "commit",
		index: staged.index,
		message: "remote change",
		requestId: randomUUID(),
		...target,
	});
	assert.equal(commit.status, 200);
	const committed = remoteFilesReplySchema.parse(await (await list()).json());
	assert.equal(committed.type, "list");
	assert.ok(committed.push);
	const push = await client.workspace({
		type: "push",
		...committed.push,
		requestId: randomUUID(),
		...target,
	});
	assert.equal(push.status, 200);
	assert.equal(
		await localGit("--git-dir", upstream, "show", "test:change space.txt"),
		"remote preview",
	);
}

/** 明示的に新規を選んだときだけ別会話へ切り替え、同じ ID を履歴から再開する。 */
async function verifyRemoteSessionHistory(
	client: Client,
	attached: RemoteChatState,
) {
	const action = {
		backendGeneration: attached.backendGeneration,
		expectedSessionId: attached.sessionId,
	};
	const created = await client.send({
		type: "session.new",
		requestId: randomUUID(),
		...action,
	});
	assert.equal(created.status, 200);
	const current = (await client.snapshot()).state;
	assert.notEqual(current.sessionId, attached.sessionId);
	const listed = await client.send({
		type: "session.list",
		requestId: randomUUID(),
		...action,
		expectedSessionId: current.sessionId,
	});
	assert.equal(listed.status, 200);
	const listedState = (await client.snapshot()).state;
	assert.ok(listedState.sessions.some(({ id }) => id === attached.sessionId));
	const loaded = await client.send({
		type: "session.load",
		requestId: randomUUID(),
		...action,
		expectedSessionId: current.sessionId,
		sessionId: attached.sessionId,
	});
	assert.equal(loaded.status, 200);
	const reopened = (await client.snapshot()).state;
	assert.equal(reopened.sessionId, attached.sessionId);
	assert.equal(
		reopened.messages.at(-1)?.text,
		attached.messages.at(-1)?.text,
	);
}

void test("ペアリングの回数制限、使い捨て、無操作失効を実時間に依存せず検証する", () => {
	let now = 0;
	const auth = new RemoteAuth(
		() => {},
		() => now,
	);
	const expired = auth.issueCode();
	now += 120_000;
	assert.throws(() => auth.pair(expired), { code: "unauthenticated" });
	const cancelled = auth.issueCode();
	auth.cancelPairing();
	assert.throws(() => auth.pair(cancelled), { code: "unauthenticated" });
	const code = auth.issueCode();
	const wrong = code === "00000000" ? "00000001" : "00000000";
	for (let i = 0; i < 4; i++) {
		assert.throws(() => auth.pair(wrong), { code: "unauthenticated" });
	}
	assert.throws(() => auth.pair(wrong), { code: "too_many_requests" });
	assert.throws(() => auth.pair(code), { code: "too_many_requests" });
	now += 60_000;
	const fresh = auth.issueCode();
	const cookie = auth.pair(fresh).split(";")[0]!;
	assert.throws(() => auth.pair(fresh), { code: "unauthenticated" });
	const session = auth.authenticate(cookie);
	const id = randomUUID();
	auth.claim(session, id);
	assert.throws(() => auth.claim(session, id), { code: "stale_session" });
	now += 30 * 60 * 1000;
	assert.throws(() => auth.authenticate(cookie), { code: "unauthenticated" });
});

void test("全量状態の件数・UTF-8 サイズを制限し、ツール本文と内部項目を除く", (t) => {
	const raw = initialState();
	raw.connection = "ready";
	raw.piAccount = "private-account";
	raw.messages = Array.from({ length: 60 }, (_, index) => ({
		id: String(index),
		role: "assistant",
		text: "メ".repeat(9000),
	}));
	raw.tools = Array.from({ length: 50 }, (_, index) => ({
		id: String(index),
		title: "private-command",
		status: "completed",
		paths: ["private-path"],
		rawOutput: "private-output",
		rawInput: "private-input",
		commandOutput: "private-command-output",
	}));
	const adapter = adapterForState(t, raw, "pi");
	const snapshot = remoteStateSchema.parse(adapter.snapshot(randomUUID()));
	const serialized = JSON.stringify(snapshot);
	assert.ok(snapshot.truncated);
	assert.equal(snapshot.tools.length, 30);
	assert.equal(snapshot.messages.at(-1)?.id, "59");
	assert.ok(snapshot.messages.length < 50);
	assert.ok(Buffer.byteLength(serialized) <= remoteStateBytes);
	for (const item of snapshot.messages) {
		assert.ok(Buffer.byteLength(item.text) <= remoteTextLimit);
		assert.ok(!item.text.includes("\uFFFD"));
	}
	assert.ok(!serialized.includes("private-"));
	verifySseBackpressure(snapshot);
});

/** 接続状態を制御し、拒否されるはずの要求が実行経路へ届いたら検出する。 */
function adapterForState(t: TestContext, state: ChatState, backend: BackendId) {
	const runtime = new BackendRuntime(
		() => ({
			snapshot: () => state,
			subscribe: () => () => {},
			receive: () =>
				Promise.reject(new Error("拒否する要求が配送されました。")),
			invalidate() {},
			dispose: () => Promise.resolve(),
		}),
		undefined,
		undefined,
		() => backend,
	);
	t.after(() => runtime.dispose());
	return new RemoteChatAdapter(
		runtime.scope("chat"),
		new BackendSelection(runtime),
		() => true,
		() => Promise.resolve(true),
		() => 0,
	);
}

for (const backend of ["pi", "codex"] as const) {
	void test(`${backend} は接続・認証・設定処理中の切替と、接続失敗時の送信を拒否する`, async (t) => {
		const ready: ChatState = {
			...initialState(),
			connection: "ready",
			sessionId: randomUUID(),
			cwd: process.cwd(),
		};
		const raw = { ...ready };
		const adapter = adapterForState(t, raw, backend);
		const connectionGeneration = randomUUID();
		const unavailable =
			backend === "pi" ? "pi-unavailable" : "codex-unavailable";
		const other = backend === "pi" ? "codex" : "pi";
		const stages: Partial<ChatState>[] = [
			{ connection: "connecting" },
			{ connection: "authenticating" },
			{ configPending: true },
			{ sessionPending: true },
		];
		for (const stage of stages) {
			Object.assign(raw, ready, stage);
			const snapshot = adapter.snapshot(connectionGeneration);
			assert.ok(
				snapshot.availableBackends.every((item) => !item.selectable),
			);
			await assert.rejects(
				adapter.apply(
					{
						type: "backend.select",
						requestId: randomUUID(),
						backend: other,
						expectedBackend: backend,
						backendGeneration: snapshot.backendGeneration,
					},
					() => true,
				),
				{ code: "backend_switch_busy" },
			);
			assert.equal(
				adapter.snapshot(connectionGeneration).backendGeneration,
				snapshot.backendGeneration,
			);
		}
		for (const connection of ["auth-required", "error"] as const) {
			Object.assign(raw, ready, {
				connection,
				error: "private-error-details",
			});
			const snapshot = adapter.snapshot(connectionGeneration);
			assert.equal(snapshot.connection, connection);
			assert.equal(
				snapshot.error,
				connection === "error" ? unavailable : null,
			);
			assert.equal(snapshot.capabilities.send, false);
			assert.ok(
				!JSON.stringify(snapshot).includes("private-error-details"),
			);
			await assert.rejects(
				adapter.apply(
					prompt(snapshot, "接続できない状態での送信"),
					() => true,
				),
				{ code: "backend_unavailable" },
			);
		}
	});
}

/** 受信が滞留した接続を使い、通常更新の間引きと 1 MiB の切断を検証する。 */
function verifySseBackpressure(snapshot: RemoteChatState) {
	const listeners = new Set<(urgent: boolean) => void>();
	const events = new RemoteEvents(
		() => snapshot,
		(notify) => {
			listeners.add(notify);
			return () => {
				listeners.delete(notify);
			};
		},
	);
	const response = new ServerResponse(new IncomingMessage(new Socket()));
	try {
		assert.ok(events.connect(response));
		for (const notify of listeners) {
			for (let count = 0; count < 10; count++) {
				notify(false);
			}
			assert.equal(response.destroyed, false);
			for (let count = 0; count < 10; count++) {
				notify(true);
			}
		}
		assert.equal(response.destroyed, true);
	} finally {
		events.disconnect();
	}
}
