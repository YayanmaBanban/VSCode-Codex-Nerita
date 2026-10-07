// 送信準備中の完了・停止・接続変更を、公開操作と本番の JSONL 通信で検証する。
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, type TestContext } from "node:test";
import * as vscode from "vscode";
import type { HostMessage } from "@nerita/shared/messages";
import { codexFixture, codexResponseGate } from "../support/codex";
import { until } from "../support/pi";

type Fixture = Awaited<ReturnType<typeof codexFixture>>;
type Controller = ReturnType<Fixture["controller"]>;

/** 現在の会話と実行を指定して、公開入口へ利用者の操作を送る。 */
async function action(
	controller: Controller,
	type: string,
	fields: Record<string, unknown> = {},
) {
	await controller.receive({
		type,
		requestId: randomUUID(),
		sessionId: controller.snapshot().sessionId,
		runId: controller.snapshot().runId,
		...fields,
	});
}

/** 終了済み会話の原文を外部 RPC で返し、読み取り応答をシナリオ側で遅らせる。 */
async function referenceFixture(t: TestContext) {
	const f = await codexFixture(t);
	const gate = codexResponseGate();
	const history = {
		thread: {
			id: "source",
			cwd: f.cwd,
			name: null,
			preview: "参照元",
			updatedAt: 1,
			status: { type: "idle" },
			historyMode: "legacy",
			turns: [
				{
					id: "source-turn",
					status: "completed",
					itemsView: "full",
					items: [
						{
							id: "source-answer",
							type: "agentMessage",
							text: "参照元の回答",
						},
					],
				},
			],
		},
	};
	t.after(() => gate.release(history));
	let reading = false;
	f.responses.set("thread/read", () => {
		reading = true;
		return gate.response;
	});
	const controller = f.controller();
	const events: HostMessage[] = [];
	controller.subscribe((event) => events.push(event));
	await controller.connect();
	return {
		...f,
		controller,
		events,
		reading: () => reading,
		release: () => gate.release(history),
	};
}

for (const outcome of ["running", "completed"]) {
	void test(`Codex の原文参照を準備中にターンが${outcome}となった場合、追加指示と新規送信を区別する`, async (t) => {
		const f = await referenceFixture(t);
		const controller = f.controller;
		await action(controller, "prompt/send", { text: "最初の指示" });
		const threadId = controller.snapshot().sessionId;
		f.notify("turn/started", {
			threadId,
			turn: { id: "turn-1", status: "inProgress", items: [] },
		});
		const sending = action(controller, "prompt/send", {
			requestId: "additional",
			text: "追加の指示",
			sessionReferences: [{ sessionId: "source", mode: "transcript" }],
		});
		await until(f.reading);
		await action(controller, "session/new", { requestId: "switch" });
		assert.equal(controller.snapshot().sessionId, threadId);
		assert.ok(
			f.events.some(
				(event) =>
					event.type === "request/failed" &&
					event.requestId === "switch",
			),
		);
		if (outcome === "completed") {
			f.notify("turn/completed", {
				threadId,
				turn: {
					id: "turn-1",
					status: "completed",
					items: [],
				},
			});
			await until(() => controller.snapshot().run === outcome);
		}
		f.release();
		await sending;
		const starts = f.requests.filter(
			(request) => request.method === "turn/start",
		);
		const steers = f.requests.filter(
			(request) => request.method === "turn/steer",
		);
		assert.equal(starts.length, outcome === "completed" ? 2 : 1);
		assert.equal(steers.length, outcome === "running" ? 1 : 0);
		const sent = outcome === "running" ? steers[0]! : starts[1]!;
		assert.equal(sent.params?.threadId, threadId);
		if (outcome === "running") {
			assert.equal(sent.params.expectedTurnId, "turn-1");
		}
		assert.ok(
			JSON.stringify(sent.params.additionalContext).includes(
				"参照元の回答",
			),
		);
		assert.ok(
			f.events.some(
				(event) =>
					event.type === "prompt/accepted" &&
					event.requestId === "additional" &&
					event.mode === (outcome === "running" ? "steer" : "start"),
			),
		);
		assert.equal(controller.snapshot().messages.at(-1)!.text, "追加の指示");
	});
}

for (const outcome of ["cancelled", "failed"]) {
	void test(`Codex の原文参照を準備中にターンが${outcome}となった場合、待機中の指示で再開せず明示的な再送を受け付ける`, async (t) => {
		const f = await referenceFixture(t);
		const controller = f.controller;
		await action(controller, "prompt/send", { text: "最初の指示" });
		const threadId = controller.snapshot().sessionId;
		const sending = action(controller, "prompt/send", {
			requestId: "additional",
			text: "追加の指示",
			sessionReferences: [{ sessionId: "source", mode: "transcript" }],
		});
		await until(f.reading);
		if (outcome === "cancelled") {
			await action(controller, "prompt/cancel");
		}
		f.notify("turn/completed", {
			threadId,
			turn: {
				id: "turn-1",
				status: outcome === "cancelled" ? "interrupted" : "failed",
				items: [],
			},
		});
		await until(() => controller.snapshot().run === outcome);
		f.release();
		await sending;
		assert.equal(
			f.requests.filter((request) => request.method === "turn/start")
				.length,
			1,
		);
		assert.ok(
			!f.requests.some((request) => request.method === "turn/steer"),
		);
		assert.ok(
			f.events.some(
				(event) =>
					event.type === "request/failed" &&
					event.requestId === "additional",
			),
		);
		assert.deepEqual(
			controller.snapshot().messages.map((message) => message.text),
			["最初の指示"],
		);
		await action(controller, "prompt/send", { text: "明示的な再送" });
		assert.equal(controller.snapshot().run, "running");
		assert.equal(
			controller.snapshot().messages.at(-1)!.text,
			"明示的な再送",
		);
	});
}

void test("Codex の MCP 一覧は全ページを現在の会話へ表示し、取得中の二重送信を拒否してモデルを実行しない", async (t) => {
	const f = await codexFixture(t);
	const gate = codexResponseGate();
	t.after(() => gate.release({ data: [], nextCursor: null }));
	let waiting = false;
	f.responses.set("mcpServerStatus/list", ({ params }) => {
		if (params?.cursor === "next") {
			waiting = true;
			return gate.response;
		}
		return {
			data: [{ name: "first", runtimeStatus: "ready" }],
			nextCursor: "next",
		};
	});
	const controller = f.controller();
	const events: HostMessage[] = [];
	controller.subscribe((event) => events.push(event));
	await controller.connect();
	const sessionId = controller.snapshot().sessionId;
	const listing = action(controller, "prompt/send", {
		requestId: "mcp",
		text: "/mcp",
	});
	await until(() => waiting);
	assert.deepEqual(controller.snapshot().messages.at(-1)!.mcp, {
		status: "loading",
	});
	await action(controller, "prompt/send", {
		requestId: "duplicate",
		text: "二重送信",
	});
	assert.ok(
		events.some(
			(event) =>
				event.type === "request/failed" &&
				event.requestId === "duplicate",
		),
	);
	gate.release({
		data: [{ name: "second", runtimeStatus: null }],
		nextCursor: null,
	});
	await listing;
	assert.equal(controller.snapshot().sessionId, sessionId);
	assert.equal(controller.snapshot().run, "idle");
	assert.deepEqual(controller.snapshot().messages.at(-1)!.mcp, {
		status: "ready",
		servers: [
			{ name: "first", runtimeStatus: "ready" },
			{ name: "second", runtimeStatus: null },
		],
	});
	assert.ok(
		!f.requests.some((request) =>
			["turn/start", "turn/steer"].includes(request.method),
		),
	);
	assert.ok(
		events.some(
			(event) =>
				event.type === "prompt/accepted" && event.requestId === "mcp",
		),
	);
	await action(controller, "prompt/send", { text: "取得後の送信" });
	assert.equal(controller.snapshot().run, "running");
});

void test("Codex の MCP 一覧の後続ページが壊れても会話を保持し、取得待ちを解除して次の送信を受け付ける", async (t) => {
	const f = await codexFixture(t);
	f.responses.set("mcpServerStatus/list", ({ params }) => ({
		data:
			params?.cursor === "next"
				? [{ name: 42, runtimeStatus: "ready" }]
				: [{ name: "first", runtimeStatus: "ready" }],
		nextCursor: params?.cursor === "next" ? null : "next",
	}));
	const controller = f.controller();
	await controller.connect();
	const sessionId = controller.snapshot().sessionId;
	await action(controller, "prompt/send", { text: "/mcp" });
	assert.equal(controller.snapshot().sessionId, sessionId);
	assert.deepEqual(controller.snapshot().messages.at(-1)!.mcp, {
		status: "error",
	});
	assert.equal(controller.snapshot().messages[0]!.text, "/mcp");
	assert.equal(controller.snapshot().run, "idle");
	await action(controller, "prompt/send", { text: "取得失敗後の送信" });
	assert.equal(controller.snapshot().run, "running");
	assert.equal(
		controller.snapshot().messages.at(-1)!.text,
		"取得失敗後の送信",
	);
});

void test("Codex は接続変更前のコード読取りが遅く失敗しても、新しい準備の待機を解除せず次の送信を二重実行しない", async (t) => {
	const f = await codexFixture(t);
	const gates = [codexResponseGate(), codexResponseGate()];
	t.after(() => {
		for (const gate of gates) {
			gate.release(undefined);
		}
	});
	let reads = 0;
	// 文書を開く VS Code の境界だけを遅らせ、取り消せない古い読み取りの後片付けを確認する。
	Object.assign(vscode.Uri, {
		parse: () => ({ scheme: "file", query: "", fragment: "" }),
	});
	Object.assign(vscode.workspace, {
		openTextDocument: async () => {
			const gate = gates[reads++]!;
			await gate.response;
			throw new Error("fixture document unavailable");
		},
	});
	t.after(() => {
		Reflect.deleteProperty(vscode.Uri, "parse");
		Reflect.deleteProperty(vscode.workspace, "openTextDocument");
	});
	const controller = f.controller();
	const events: HostMessage[] = [];
	controller.subscribe((event) => events.push(event));
	await controller.connect();
	const codeReferences = [
		{
			uri: pathToFileURL(join(f.cwd, "source.ts")).href,
			range: {
				start: { line: 0, character: 0 },
				end: { line: 0, character: 1 },
			},
		},
	];
	const old = action(controller, "prompt/send", {
		text: "旧接続の準備",
		codeReferences,
	});
	await until(() => reads === 1);
	controller.invalidate();
	await controller.connect();
	const sessionId = controller.snapshot().sessionId;
	const current = action(controller, "prompt/send", {
		text: "新接続の準備",
		codeReferences,
	});
	await until(() => reads === 2);
	gates[0]!.release(undefined);
	await old;
	await action(controller, "prompt/send", {
		requestId: "duplicate",
		text: "二重送信",
	});
	assert.ok(
		events.some(
			(event) =>
				event.type === "request/failed" &&
				event.requestId === "duplicate",
		),
	);
	assert.ok(!f.requests.some((request) => request.method === "turn/start"));
	assert.equal(controller.snapshot().sessionId, sessionId);
	assert.deepEqual(controller.snapshot().messages, []);
	gates[1]!.release(undefined);
	await current;
	await action(controller, "prompt/send", { text: "準備失敗後の送信" });
	const starts = f.requests.filter(
		(request) => request.method === "turn/start",
	);
	assert.equal(starts.length, 1);
	assert.equal(starts[0]!.params?.threadId, sessionId);
	assert.equal(
		controller.snapshot().messages.at(-1)!.text,
		"準備失敗後の送信",
	);
});
