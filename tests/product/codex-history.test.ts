// ページ応答を子プロセスとの JSONL 通信へ流し、履歴の公開・出力取得・失敗時の保持を確認する。
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import type { HostMessage } from "@nerita/shared/messages";
import type { ToolOutputResponse } from "@nerita/shared/toolOutput";
import { codexFixture } from "../support/codex";

type Controller = ReturnType<
	Awaited<ReturnType<typeof codexFixture>>["controller"]
>;
const text = `先頭\n${"日本語🐈\n".repeat(100000)}末尾`;

/** 公開 RPC の履歴だけを設定し、本番の変換・保存処理へ渡す。 */
async function historyFixture(t: TestContext) {
	const f = await codexFixture(t);
	const thread = (id: string) => ({
		id,
		cwd: f.cwd,
		name: null,
		preview: id,
		updatedAt: 1,
		status: { type: "idle" },
		historyMode: "paginated",
		turns: [],
	});
	f.responses.set("thread/list", () => ({
		data: [thread("saved"), thread("broken")],
		nextCursor: null,
	}));
	f.responses.set("thread/read", ({ params }) => ({
		thread: thread(String(params!.threadId)),
	}));
	for (const method of ["thread/resume", "thread/fork"]) {
		f.responses.set(method, ({ params }) => ({
			thread: thread(
				method === "thread/fork" ? "forked" : String(params!.threadId),
			),
			model: "model-a",
			cwd: f.cwd,
		}));
	}
	f.responses.set("thread/turns/list", ({ params }) => ({
		data: [
			{
				id: params!.cursor ? "second" : "first",
				status: "completed",
				itemsView: "summary",
				items: [],
			},
		],
		nextCursor: params!.cursor ? null : "turn-next",
	}));
	f.responses.set("thread/items/list", ({ params }) => ({
		data: [
			{
				turnId: params!.turnId,
				item: params!.cursor
					? { id: "answer", type: "agentMessage", text: "完了" }
					: {
							id: "command",
							type: "commandExecution",
							command: "emit output",
							cwd: f.cwd,
							status: "completed",
							exitCode: 0,
							aggregatedOutput: text,
						},
			},
		],
		nextCursor: params!.cursor ? null : "item-next",
	}));
	const controller = f.controller();
	const events: HostMessage[] = [];
	t.after(controller.subscribe((event) => events.push(event)));
	await controller.connect();
	return { ...f, thread, controller, events };
}

/** 出力の末尾を Webview と同じバイト範囲要求で取得する。 */
async function readTail(controller: Controller, outputRef: string) {
	let result: ToolOutputResponse | undefined;
	const unsubscribe = controller.subscribe((event) => {
		if (event.type === "tool/outputResult") {
			result = event;
		}
	});
	try {
		await controller.receive({
			type: "tool/output",
			requestId: randomUUID(),
			outputRef,
			offset: Buffer.byteLength(text) - Buffer.byteLength("末尾"),
			limit: 65536,
		});
		assert.ok(result);
		return result;
	} finally {
		unsubscribe();
	}
}

/** UI と同じ履歴操作を送る。 */
async function historyAction(
	controller: Controller,
	sessionId: string,
	type = "session/load",
) {
	await controller.receive({ type, requestId: randomUUID(), sessionId });
}

void test("Codex の複数ページを復元・フォークし、全文を再実行せず取得する", async (t) => {
	const f = await historyFixture(t);
	await historyAction(f.controller, "saved");
	const loaded = f.controller.snapshot();
	assert.equal(loaded.sessionsError, null);
	assert.equal(loaded.sessionId, "saved");
	assert.equal(loaded.tools.length, 2);
	assert.equal(loaded.messages.length, 2);
	assert.ok(JSON.stringify(loaded.tools).length < 6000);
	const ref = loaded.tools[0]!.output!.outputRef!;
	assert.equal((await readTail(f.controller, ref)).text, "末尾");
	assert.ok(
		f.requests
			.filter((request) => request.method === "thread/turns/list")
			.every((request) => request.params!.itemsView === "summary"),
	);
	await historyAction(f.controller, "saved", "session/fork");
	assert.equal(f.controller.snapshot().sessionId, "forked");
	assert.ok((await readTail(f.controller, ref)).error);
	const forkRef = f.controller.snapshot().tools[0]!.output!.outputRef!;
	assert.notEqual(forkRef, ref);
	assert.equal((await readTail(f.controller, forkRef)).text, "末尾");
	assert.ok(!f.requests.some((request) => request.method === "turn/start"));
});

void test("Codex の後続ページが壊れても現在の会話と全文参照を保持する", async (t) => {
	const f = await historyFixture(t);
	await historyAction(f.controller, "saved");
	const before = f.controller.snapshot();
	const original = f.responses.get("thread/items/list")!;
	for (const failure of ["wrong-turn", "repeated-cursor"]) {
		f.responses.set("thread/items/list", (request) => {
			if (!request.params!.cursor) {
				return original(request);
			}
			return failure === "wrong-turn"
				? {
						data: [
							{
								turnId: "unexpected",
								item: {
									id: "x",
									type: "agentMessage",
									text: "混入",
								},
							},
						],
						nextCursor: null,
					}
				: { data: [], nextCursor: "item-next" };
		});
		await historyAction(f.controller, "broken");
		const after = f.controller.snapshot();
		assert.ok(after.sessionsError);
		assert.equal(after.sessionId, before.sessionId);
		assert.deepEqual(after.tools, before.tools);
		assert.deepEqual(after.messages, before.messages);
		assert.equal(
			(await readTail(f.controller, before.tools[0]!.output!.outputRef!))
				.text,
			"末尾",
		);
	}
});

void test("Codex の子履歴の全文参照を親に引き継ぎ、会話切替で失効させる", async (t) => {
	const f = await historyFixture(t);
	const original = f.responses.get("thread/items/list")!;
	f.responses.set("thread/items/list", (request) =>
		request.params!.threadId === "saved"
			? {
					data: [
						{
							turnId: request.params!.turnId,
							item: {
								id: "activity",
								type: "subAgentActivity",
								agentThreadId: "child",
								agentPath: "child",
								kind: "started",
							},
						},
					],
					nextCursor: null,
				}
			: original(request),
	);
	await historyAction(f.controller, "saved");
	assert.equal(f.controller.snapshot().agents.length, 1);
	await f.controller.receive({
		type: "agent/read",
		requestId: randomUUID(),
		sessionId: "saved",
		threadId: "child",
	});
	const event = f.events.find((event) => event.type === "agent/view");
	assert.equal(event?.type, "agent/view");
	assert.equal(f.controller.snapshot().sessionId, "saved");
	assert.ok(JSON.stringify(event.view.tools).length < 6000);
	const ref = event.view.tools[0]!.output!.outputRef!;
	assert.equal((await readTail(f.controller, ref)).text, "末尾");
	await f.controller.receive({
		type: "agent/read",
		requestId: randomUUID(),
		sessionId: "saved",
		threadId: "child",
	});
	const latest = [...f.events]
		.reverse()
		.find((event) => event.type === "agent/view");
	assert.equal(latest?.type, "agent/view");
	const latestRef = latest.view.tools[0]!.output!.outputRef!;
	assert.ok((await readTail(f.controller, ref)).error);
	assert.equal((await readTail(f.controller, latestRef)).text, "末尾");
	assert.ok(
		f.requests
			.filter(
				(request) =>
					request.method === "thread/read" &&
					request.params!.threadId === "child",
			)
			.every((request) => !request.params!.includeTurns),
	);
	await historyAction(f.controller, "broken");
	assert.equal(f.controller.snapshot().sessionId, "broken");
	assert.ok((await readTail(f.controller, latestRef)).error);
});

void test("Codex のページ取得中に切断した場合は遅い復元結果を公開しない", async (t) => {
	const f = await historyFixture(t);
	const original = f.responses.get("thread/items/list")!;
	f.responses.set("thread/items/list", (request) => {
		if (request.params!.cursor) {
			f.controller.invalidate();
		}
		return original(request);
	});
	await historyAction(f.controller, "saved");
	assert.equal(f.controller.snapshot().connection, "disconnected");
	assert.equal(f.controller.snapshot().sessionId, null);
	assert.deepEqual(f.controller.snapshot().tools, []);
	assert.ok(
		!f.requests.some(
			(request) =>
				request.method === "thread/turns/list" &&
				request.params!.cursor,
		),
	);
});

void test("Codex の本文を一括で返す旧形式も出力参照へ変換して復元する", async (t) => {
	const f = await historyFixture(t);
	f.responses.set("thread/resume", () => ({
		thread: {
			...f.thread("saved"),
			historyMode: "legacy",
			turns: [
				{
					id: "legacy",
					status: "completed",
					itemsView: "full",
					items: [
						{
							id: "command",
							type: "commandExecution",
							command: "output",
							cwd: f.cwd,
							status: "completed",
							exitCode: 0,
							aggregatedOutput: text,
						},
					],
				},
			],
		},
		model: "model-a",
		cwd: f.cwd,
	}));
	await historyAction(f.controller, "saved");
	assert.equal(f.controller.snapshot().sessionId, "saved");
	assert.equal(
		(
			await readTail(
				f.controller,
				f.controller.snapshot().tools[0]!.output!.outputRef!,
			)
		).text,
		"末尾",
	);
	assert.ok(
		!f.requests.some((request) =>
			["thread/turns/list", "thread/items/list"].includes(request.method),
		),
	);
});
