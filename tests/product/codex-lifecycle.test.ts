// 本番の JSONL 接続を使い、起動の取り消し・終了待ち・認証後の初期化を公開操作から検証する。
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import type { CodexFactory } from "../../apps/vscode-nerita/src/extension/backends/codex/runtime/connection";
import { codexFixture, codexResponseGate, type Rpc } from "../support/codex";
import { until } from "../support/pi";

type Fixture = Awaited<ReturnType<typeof codexFixture>>;
type Controller = ReturnType<Fixture["controller"]>;
type Connection = Awaited<ReturnType<CodexFactory>>;
type Callbacks = Parameters<CodexFactory>[0];

/** UI が持つ現在の会話・実行 ID で、公開入口へ操作を送る。 */
async function action(
	controller: Controller,
	type: string,
	fields: Record<string, unknown> = {},
) {
	const state = controller.snapshot();
	await controller.receive({
		type,
		requestId: randomUUID(),
		sessionId: state.sessionId,
		runId: state.runId,
		...fields,
	});
}

for (const reconnect of [false, true]) {
	void test(`Codex は取消し後の遅い起動結果を回収し、回収前に${reconnect ? "再接続を始めない" : "終了完了を返さない"}`, async (t) => {
		const gate = codexResponseGate();
		let opened: Connection | undefined;
		t.after(async () => {
			gate.release({});
			await opened?.client.dispose();
		});
		const f = await codexFixture(t);
		let openingCount = 0;
		let oldCallbacks: Callbacks | undefined;
		let oldSignal: AbortSignal | undefined;
		const factory: CodexFactory = async (callbacks, signal) => {
			if (++openingCount === 1) {
				oldCallbacks = callbacks;
				oldSignal = signal;
				// 外部の起動が取消しに間に合わず、接続を遅れて返す状況を作る。
				opened = await f.factory(
					callbacks,
					new AbortController().signal,
				);
				await gate.response;
				return opened;
			}
			assert.ok(opened);
			await assert.rejects(opened.client.readAccount(), /切断/u);
			return f.factory(callbacks, signal);
		};
		const controller = f.controller(
			undefined,
			undefined,
			undefined,
			factory,
		);
		let published = 0;
		controller.subscribe(() => published++);
		const opening = controller.connect();
		await until(() => opened !== undefined);
		controller.invalidate();
		assert.equal(oldSignal?.aborted, true);
		let ended = false;
		const ending = (
			reconnect ? controller.connect() : controller.dispose()
		).then(() => {
			ended = true;
		});
		const before = published;
		await setTimeout(75);
		assert.equal(ended, false);
		assert.equal(openingCount, 1);
		assert.equal(f.requests.filter(isThreadStart).length, 0);
		gate.release({});
		await Promise.all([opening, ending]);
		assert.ok(opened);
		assert.ok(oldCallbacks);
		if (reconnect) {
			assert.equal(openingCount, 2);
			assert.equal(controller.snapshot().connection, "ready");
			assert.equal(f.requests.filter(isThreadStart).length, 1);
			await verifyObsoleteCallbacks(controller, oldCallbacks);
		} else {
			await assert.rejects(opened.client.readAccount(), /切断/u);
			assert.equal(published, before);
		}
	});
}

/** 古い接続の遅延配信は、新しい会話の ID が一致していても承認・本文・実行を変更しない。 */
async function verifyObsoleteCallbacks(
	controller: Controller,
	callbacks: Callbacks,
) {
	await action(controller, "prompt/send", { text: "再接続後の指示" });
	const threadId = controller.snapshot().sessionId;
	const answer = callbacks.request!(
		{
			id: 1,
			method: "item/commandExecution/requestApproval",
			params: { threadId, turnId: "turn-1", itemId: "old-request" },
		},
		AbortSignal.timeout(1_000),
	);
	await setTimeout(75);
	assert.deepEqual(controller.snapshot().permissions, []);
	assert.deepEqual(await answer, { decision: "cancel" });
	callbacks.notification!({
		method: "thread/name/updated",
		params: { threadId, threadName: "旧接続からのタイトル" },
	});
	callbacks.disconnected!(new Error("旧接続の終了通知"));
	assert.notEqual(controller.snapshot().sessionTitle, "旧接続からのタイトル");
	assert.equal(controller.snapshot().connection, "ready");
	assert.equal(controller.snapshot().run, "running");
	assert.equal(controller.snapshot().error, null);
}

/** 遅い接続の会話を混ぜないことを、サーバーが受けた RPC で確認する。 */
function isThreadStart(request: Rpc): boolean {
	return request.method === "thread/start";
}

for (const authenticated of [false, true]) {
	void test(`Codex はログイン完了後の認証を確認し、${authenticated ? "設定と一覧の初期化完了まで送信を受け付けない" : "未認証なら会話を開始しない"}`, async (t) => {
		const account = codexResponseGate();
		const catalog = codexResponseGate();
		t.after(() => {
			account.release({ account: null, requiresOpenaiAuth: true });
			catalog.release({ data: [], nextCursor: null });
		});
		const f = await codexFixture(t);
		f.state.authenticated = false;
		let accountChecks = 0;
		f.responses.set("account/read", () =>
			++accountChecks === 1
				? { account: null, requiresOpenaiAuth: true }
				: account.response,
		);
		let catalogWaiting = false;
		f.responses.set("thread/list", () => {
			catalogWaiting = true;
			return catalog.response;
		});
		const urls: string[] = [];
		const controller = f.controller({
			open: (url) => {
				urls.push(url);
				return Promise.resolve();
			},
			apiKey: () => undefined,
		});
		const failed: string[] = [];
		controller.subscribe((event) => {
			if (event.type === "request/failed") {
				failed.push(event.requestId);
			}
		});
		await controller.connect();
		assert.equal(controller.snapshot().connection, "auth-required");
		const login = action(controller, "auth/start", { methodId: "chatgpt" });
		await until(() => urls.length === 1);
		f.notify("account/login/completed", {
			loginId: "login-1",
			success: true,
		});
		await until(() => accountChecks === 2);
		assert.equal(controller.snapshot().connection, "authenticating");
		assert.equal(controller.snapshot().sessionId, null);
		assert.equal(f.requests.filter(isThreadStart).length, 0);
		account.release({
			account: authenticated ? { type: "apiKey" } : null,
			requiresOpenaiAuth: true,
		});
		if (!authenticated) {
			await login;
			assert.equal(controller.snapshot().connection, "auth-required");
			assert.equal(controller.snapshot().sessionId, null);
			assert.equal(f.requests.filter(isThreadStart).length, 0);
			assert.equal(catalogWaiting, false);
			return;
		}

		await until(() => catalogWaiting);
		assert.equal(controller.snapshot().connection, "ready");
		assert.equal(controller.snapshot().sessionPending, true);
		assert.deepEqual(
			controller.agentModels().map((model) => model.value),
			["model-a", "model-b"],
		);
		await action(controller, "prompt/send", {
			text: "初期化待ちの指示",
			requestId: "initialization-prompt",
		});
		assert.ok(failed.includes("initialization-prompt"));
		assert.equal(f.state.turn, 0);
		catalog.release({ data: [], nextCursor: null });
		await login;
		assert.equal(controller.snapshot().sessionPending, false);
		assert.equal(controller.snapshot().error, null);
		await action(controller, "prompt/send", { text: "初期化後の指示" });
		assert.equal(controller.snapshot().run, "running");
		assert.equal(f.state.turn, 1);
		assert.equal(f.requests.filter(isThreadStart).length, 1);
	});
}
