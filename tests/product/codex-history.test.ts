// ページ応答を子プロセスとの JSONL 通信へ流し、履歴の公開・出力取得・失敗時の保持を確認する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, type TestContext } from "node:test";
import * as z from "zod";
import type { HostMessage } from "@nerita/shared/messages";
import type { ToolOutputResponse } from "@nerita/shared/toolOutput";
import { codexFixture, codexResponseGate } from "../support/codex";
import { until } from "../support/pi";

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
		thread: thread(z.string().parse(params!.threadId)),
	}));
	for (const method of ["thread/resume", "thread/fork"]) {
		f.responses.set(method, ({ params }) => ({
			thread: thread(
				method === "thread/fork"
					? "forked"
					: z.string().parse(params!.threadId),
			),
			model: "model-a",
			cwd: f.cwd,
		}));
	}
	f.responses.set("thread/turns/list", ({ params }) => ({
		data: [
			{
				id: Boolean(params!.cursor) ? "second" : "first",
				status: "completed",
				itemsView: "summary",
				items: [],
			},
		],
		nextCursor: Boolean(params!.cursor) ? null : "turn-next",
	}));
	f.responses.set("thread/items/list", ({ params }) => ({
		data: [
			{
				turnId: params!.turnId,
				item: Boolean(params!.cursor)
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
		nextCursor: Boolean(params!.cursor) ? null : "item-next",
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

void test("Codex の履歴再開応答に含まれるフルアクセス権限を設定表示へ反映する", async (t) => {
	const f = await historyFixture(t);
	f.responses.set("thread/resume", () => ({
		thread: f.thread("saved"),
		model: "model-a",
		cwd: f.cwd,
		sandbox: { type: "dangerFullAccess" },
		approvalsReviewer: "user",
	}));
	await historyAction(f.controller, "saved");
	assertPermissionDisplay(f.controller, "danger-full-access", true);
});

void test("Codex の履歴復元は保存済みのモデル選択に置き換えず、次の新規会話には保存選択を適用する", async (t) => {
	const f = await historyFixture(t);
	for (const [configId, value] of [
		["model", "model-b"],
		["reasoning_effort", "high"],
	]) {
		await f.controller.receive({
			type: "config/set",
			requestId: randomUUID(),
			sessionId: f.controller.snapshot().sessionId,
			configId,
			value,
		});
	}
	f.responses.set("thread/resume", () => ({
		thread: f.thread("saved"),
		model: "model-a",
		reasoningEffort: "low",
		cwd: f.cwd,
	}));
	await historyAction(f.controller, "saved");
	const options = f.controller.snapshot().configOptions;
	assert.equal(
		options.find((option) => option.id === "model")?.currentValue,
		"model-a",
	);
	assert.equal(
		options.find((option) => option.id === "reasoning_effort")
			?.currentValue,
		"low",
	);
	await f.controller.receive({
		type: "prompt/send",
		requestId: randomUUID(),
		sessionId: "saved",
		text: "履歴を続ける",
	});
	const resumed = f.requests.find(
		(request) => request.method === "turn/start",
	)!;
	assert.deepEqual(resumed.params?.collaborationMode, {
		mode: "default",
		settings: {
			model: "model-a",
			reasoning_effort: "low",
			developer_instructions: null,
		},
	});
	f.notify("turn/completed", {
		threadId: "saved",
		turn: { id: "turn-1", status: "completed", items: [] },
	});
	await until(() => f.controller.snapshot().run === "completed");
	await historyAction(f.controller, "saved", "session/new");
	await f.controller.receive({
		type: "prompt/send",
		requestId: randomUUID(),
		sessionId: f.controller.snapshot().sessionId,
		text: "新規会話",
	});
	const starts = f.requests.filter(
		(request) => request.method === "turn/start",
	);
	assert.equal(starts.length, 2);
	assert.equal(starts[1]!.params?.model, "model-b");
	assert.equal(starts[1]!.params.effort, "high");
});

void test("Codex の履歴再開後の権限通知を表示と次の送信へ反映し、他スレッドの通知を混ぜない", async (t) => {
	const f = await historyFixture(t);
	await historyAction(f.controller, "saved");
	const initialRevision = f.controller.snapshot().revision;
	f.notify("thread/settings/updated", {
		threadId: "saved",
		threadSettings: {
			sandboxPolicy: { type: "dangerFullAccess" },
			approvalsReviewer: "user",
		},
	});
	f.notify("account/rateLimits/updated", { rateLimits: {} });
	await until(() => f.controller.snapshot().revision > initialRevision);
	assertPermissionDisplay(f.controller, "danger-full-access", true);
	await f.controller.receive({
		type: "config/set",
		requestId: randomUUID(),
		sessionId: "saved",
		configId: "mode",
		value: "danger-full-access",
	});
	const sandboxPolicy = {
		type: "workspaceWrite",
		writableRoots: [f.cwd],
		networkAccess: false,
		excludeTmpdirEnvVar: false,
		excludeSlashTmp: false,
	};
	const revision = f.controller.snapshot().revision;
	f.notify("thread/settings/updated", {
		threadId: "saved",
		threadSettings: { sandboxPolicy, approvalsReviewer: "auto_review" },
	});
	f.notify("account/rateLimits/updated", { rateLimits: {} });
	await until(() => f.controller.snapshot().revision > revision);
	assertPermissionDisplay(f.controller, "workspace-write", false);
	assert.equal(
		f.controller
			.snapshot()
			.configOptions.find((option) => option.id === "approvals_reviewer")
			?.currentValue,
		"auto_review",
	);
	const nextRevision = f.controller.snapshot().revision;
	f.notify("thread/settings/updated", {
		threadId: "other",
		threadSettings: {
			sandboxPolicy: { type: "dangerFullAccess" },
			approvalsReviewer: "user",
		},
	});
	f.notify("account/rateLimits/updated", { rateLimits: {} });
	await until(() => f.controller.snapshot().revision > nextRevision);
	assertPermissionDisplay(f.controller, "workspace-write", false);
	await f.controller.receive({
		type: "prompt/send",
		requestId: randomUUID(),
		sessionId: "saved",
		text: "続ける",
	});
	const start = [...f.requests]
		.reverse()
		.find((request) => request.method === "turn/start")!;
	assert.equal(start.params?.sandboxPolicy, undefined);
	assert.equal(start.params?.approvalsReviewer, "auto_review");
});

/** Host の現在値と、Webview へ渡す権限カードの値・警告表示を確認する。 */
function assertPermissionDisplay(
	controller: Controller,
	mode: string,
	warning: boolean,
) {
	const state = controller.snapshot();
	assert.equal(
		state.configOptions.find((option) => option.id === "mode")
			?.currentValue,
		mode,
	);
	const control = state.uiContributions?.items.find(
		(item) => item.id === "config:mode",
	)?.control;
	assert.equal(control?.type, "slider-card");
	assert.equal(control.option.currentValue, mode);
	assert.equal(control.warning, warning);
}

void test("Codex の複数ページの履歴を復元・フォークし、ツールを再実行せず出力の末尾を取得する", async (t) => {
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
	assert.ok(
		f.controller
			.snapshot()
			.sessions.some((row) => row.sessionId === "forked"),
	);
	assert.ok(isNonEmptyString((await readTail(f.controller, ref)).error));
	const forkRef = f.controller.snapshot().tools[0]!.output!.outputRef!;
	assert.notEqual(forkRef, ref);
	assert.equal((await readTail(f.controller, forkRef)).text, "末尾");
	assert.ok(!f.requests.some((request) => request.method === "turn/start"));
});

void test("Codex の一覧未反映のフォークを名前変更・アーカイブ・復帰し、復帰した履歴の全文を取得できる", async (t) => {
	const f = await historyFixture(t);
	for (const method of ["thread/name/set", "thread/archive"]) {
		f.responses.set(method, () => ({}));
	}
	f.responses.set("thread/unarchive", () => ({ thread: f.thread("forked") }));
	await historyAction(f.controller, "saved", "session/fork");
	const initialRef = f.controller.snapshot().tools[0]!.output!.outputRef!;
	await f.controller.receive({
		type: "session/rename",
		requestId: randomUUID(),
		sessionId: "forked",
		name: "  利用者が変更  ",
	});
	const renamed = f.controller.snapshot();
	assert.equal(renamed.sessionTitle, "利用者が変更");
	assert.equal(
		renamed.sessions.find((row) => row.sessionId === "forked")?.title,
		"利用者が変更",
	);
	assert.equal((await readTail(f.controller, initialRef)).text, "末尾");
	await historyAction(f.controller, "forked", "session/archive");
	const archived = f.controller.snapshot();
	assert.equal(archived.sessionId, null);
	assert.deepEqual(archived.messages, []);
	assert.deepEqual(archived.tools, []);
	assert.deepEqual(archived.configOptions, []);
	assert.ok(
		isNonEmptyString((await readTail(f.controller, initialRef)).error),
	);
	await f.controller.receive({
		type: "session/list",
		requestId: randomUUID(),
		archived: true,
	});
	assert.equal(
		f.controller
			.snapshot()
			.sessions.find((row) => row.sessionId === "forked")?.archived,
		true,
	);

	await historyAction(f.controller, "forked", "session/unarchive");
	const revived = f.controller.snapshot();
	assert.equal(revived.sessionsError, null);
	assert.equal(revived.sessionsArchived, true);
	assert.ok(
		!revived.sessions.some((row) => row.sessionId === "forked"),
		"復帰したフォークをアーカイブ一覧に残さない",
	);
	await f.controller.receive({
		type: "session/list",
		requestId: randomUUID(),
		archived: false,
	});
	assert.equal(
		f.controller
			.snapshot()
			.sessions.find((row) => row.sessionId === "forked")?.archived,
		false,
	);
	await historyAction(f.controller, "forked");
	const restoredRef = f.controller.snapshot().tools[0]!.output!.outputRef!;
	assert.equal((await readTail(f.controller, restoredRef)).text, "末尾");
	const mutations = f.requests.filter((request) =>
		["thread/name/set", "thread/archive", "thread/unarchive"].includes(
			request.method,
		),
	);
	assert.deepEqual(
		mutations.map(({ method, params }) => ({ method, params })),
		[
			{
				method: "thread/name/set",
				params: { threadId: "forked", name: "利用者が変更" },
			},
			{ method: "thread/archive", params: { threadId: "forked" } },
			{ method: "thread/unarchive", params: { threadId: "forked" } },
		],
	);
});

void test("Codex の表示中のフォークを削除すると会話と一覧から除き、全文参照を失効させる", async (t) => {
	const f = await historyFixture(t);
	f.responses.set("thread/delete", () => ({}));
	await historyAction(f.controller, "saved", "session/fork");
	const ref = f.controller.snapshot().tools[0]!.output!.outputRef!;
	await historyAction(f.controller, "forked", "session/delete");
	const state = f.controller.snapshot();
	assert.equal(state.sessionId, null);
	assert.deepEqual(state.messages, []);
	assert.deepEqual(state.tools, []);
	assert.deepEqual(state.agents, []);
	assert.deepEqual(state.configOptions, []);
	assert.equal(state.sessionPending, false);
	assert.ok(!state.sessions.some((row) => row.sessionId === "forked"));
	assert.ok(isNonEmptyString((await readTail(f.controller, ref)).error));
	const deleted = f.requests.filter(
		(request) => request.method === "thread/delete",
	);
	assert.equal(deleted.length, 1);
	assert.deepEqual(deleted[0]!.params, { threadId: "forked" });
});

void test("Codex の履歴一覧は同じ作業場所の後続ページを統合し、カーソルの循環でも表示済みの行と会話を保持する", async (t) => {
	const f = await historyFixture(t);
	const sessionId = f.controller.snapshot().sessionId;
	f.responses.set("thread/list", ({ params }) => ({
		data: Boolean(params!.cursor)
			? [
					f.thread("second"),
					{ ...f.thread("outside"), cwd: join(f.cwd, "other") },
				]
			: [f.thread("first")],
		nextCursor: Boolean(params!.cursor) ? "last-page" : "next-page",
	}));
	await f.controller.receive({
		type: "session/list",
		requestId: randomUUID(),
	});
	await f.controller.receive({
		type: "session/list",
		requestId: randomUUID(),
		more: true,
	});
	assert.deepEqual(
		f.controller.snapshot().sessions.map((row) => row.sessionId),
		["first", "second"],
	);
	assert.equal(f.controller.snapshot().sessionsNextCursor, "last-page");

	f.responses.set("thread/list", () => ({
		data: [f.thread("unexpected")],
		nextCursor: "next-page",
	}));
	await f.controller.receive({
		type: "session/list",
		requestId: randomUUID(),
		more: true,
	});
	const state = f.controller.snapshot();
	assert.deepEqual(
		state.sessions.map((row) => row.sessionId),
		["first", "second"],
	);
	assert.ok(isNonEmptyString(state.sessionsError));
	assert.equal(state.sessionsLoading, false);
	assert.equal(state.sessionId, sessionId);
});

void test("Codex の一覧未反映のフォークも外部の名前変更・アーカイブを反映し、アーカイブした会話を送信対象から外す", async (t) => {
	const f = await historyFixture(t);
	await historyAction(f.controller, "saved", "session/fork");
	f.notify("thread/name/updated", {
		threadId: "forked",
		threadName: "別画面で変更",
	});
	await until(() => {
		const state = f.controller.snapshot();
		return state.sessionTitle === "別画面で変更" && !state.sessionsLoading;
	});
	assert.equal(f.controller.snapshot().sessionTitle, "別画面で変更");
	assert.equal(
		f.controller
			.snapshot()
			.sessions.find((row) => row.sessionId === "forked")?.title,
		"別画面で変更",
	);

	f.notify("thread/archived", { threadId: "forked" });
	await until(() => {
		const state = f.controller.snapshot();
		return state.sessionId === null && !state.sessionsLoading;
	});
	const archived = f.controller.snapshot();
	assert.equal(archived.run, "idle");
	assert.equal(archived.messages.length, 2);
	assert.equal(archived.tools.length, 2);
	assert.deepEqual(archived.configOptions, []);
	assert.deepEqual(archived.permissions, []);
	assert.ok(!archived.sessions.some((row) => row.sessionId === "forked"));

	await f.controller.receive({
		type: "session/list",
		requestId: randomUUID(),
		archived: true,
	});
	const row = f.controller
		.snapshot()
		.sessions.find((row) => row.sessionId === "forked");
	assert.ok(row);
	assert.equal(row.title, "別画面で変更");
	assert.equal(row.archived, true);
});

void test("Codex の後続ページが壊れても現在の会話と全文参照を保持する", async (t) => {
	const f = await historyFixture(t);
	await historyAction(f.controller, "saved");
	const before = f.controller.snapshot();
	const original = f.responses.get("thread/items/list")!;
	for (const failure of ["wrong-turn", "repeated-cursor"]) {
		f.responses.set("thread/items/list", (request) => {
			if (!Boolean(request.params!.cursor)) {
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
		assert.ok(isNonEmptyString(after.sessionsError));
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

void test("Codex の操作前確認中に履歴の実行開始が届いた場合は、古い確認応答で再開せず現在の会話を保持する", async (t) => {
	const f = await historyFixture(t);
	await historyAction(f.controller, "saved");
	const before = f.controller.snapshot();
	const original = f.responses.get("thread/read")!;
	const gate = codexResponseGate();
	t.after(() => gate.release({ thread: f.thread("broken") }));
	let waiting = false;
	f.responses.set("thread/read", (request) => {
		if (request.params!.threadId === "broken") {
			waiting = true;
			return gate.response;
		}
		return original(request);
	});
	const restoring = historyAction(f.controller, "broken");
	await until(() => waiting);
	f.notify("turn/started", {
		threadId: "broken",
		turn: { id: "concurrent", status: "inProgress", items: [] },
	});
	f.notify("thread/tokenUsage/updated", {
		threadId: "saved",
		tokenUsage: { last: { totalTokens: 1 }, modelContextWindow: 100 },
	});
	await until(() => f.controller.snapshot().usage?.used === 1);
	gate.release({ thread: f.thread("broken") });
	await restoring;
	const resumes = f.requests.filter(
		(request) =>
			request.method === "thread/resume" &&
			request.params!.threadId === "broken",
	);
	assert.equal(resumes.length, 0);
	const after = f.controller.snapshot();
	assert.equal(after.sessionId, "saved");
	assert.deepEqual(after.messages, before.messages);
	assert.deepEqual(after.tools, before.tools);
	assert.ok(isNonEmptyString(after.sessionsError));
	assert.equal(after.sessionPending, false);
	assert.equal(
		(await readTail(f.controller, before.tools[0]!.output!.outputRef!))
			.text,
		"末尾",
	);
});

for (const method of ["turn/started", "thread/archived", "thread/deleted"]) {
	void test(`Codex の履歴復元中に ${method} が届いた場合は現在の会話と全文参照を保持する`, async (t) => {
		const f = await historyFixture(t);
		await historyAction(f.controller, "saved");
		const before = f.controller.snapshot();
		const original = f.responses.get("thread/items/list")!;
		const gate = codexResponseGate();
		t.after(() => gate.release({ data: [], nextCursor: null }));
		let waiting = false;
		f.responses.set("thread/items/list", (request) => {
			if (
				request.params!.threadId === "broken" &&
				Boolean(request.params!.cursor)
			) {
				waiting = true;
				return gate.response;
			}
			return original(request);
		});
		const restoring = historyAction(f.controller, "broken");
		await until(() => waiting);
		assert.equal(f.controller.snapshot().sessionPending, true);
		f.notify(method, {
			threadId: "broken",
			turn: { id: "concurrent", status: "inProgress", items: [] },
		});
		// 同じストリームの後続通知を待ち、競合通知が到着してからページを返す。
		f.notify("thread/tokenUsage/updated", {
			threadId: "saved",
			tokenUsage: { last: { totalTokens: 1 }, modelContextWindow: 100 },
		});
		await until(() => f.controller.snapshot().usage?.used === 1);
		gate.release({ data: [], nextCursor: null });
		await restoring;
		const after = f.controller.snapshot();
		assert.equal(after.sessionId, "saved");
		assert.deepEqual(after.messages, before.messages);
		assert.deepEqual(after.tools, before.tools);
		assert.equal(after.sessionPending, false);
		assert.ok(isNonEmptyString(after.sessionsError));
		assert.equal(
			(await readTail(f.controller, before.tools[0]!.output!.outputRef!))
				.text,
			"末尾",
		);
	});
}

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
	assert.ok(isNonEmptyString((await readTail(f.controller, ref)).error));
	assert.equal((await readTail(f.controller, latestRef)).text, "末尾");
	assert.ok(
		f.requests
			.filter(
				(request) =>
					request.method === "thread/read" &&
					request.params!.threadId === "child",
			)
			.every((request) => !Boolean(request.params!.includeTurns)),
	);
	await historyAction(f.controller, "broken");
	assert.equal(f.controller.snapshot().sessionId, "broken");
	assert.ok(
		isNonEmptyString((await readTail(f.controller, latestRef)).error),
	);
});

for (const changed of [false, true]) {
	void test(`Codex の遅い子メタデータは名前を補い、取得中の状態通知を優先する（通知=${changed}）`, async (t) => {
		const f = await historyFixture(t);
		const threadId = f.controller.snapshot().sessionId!;
		const gate = codexResponseGate();
		const reply = {
			thread: { ...f.thread("child"), agentNickname: "取得した名前" },
		};
		t.after(() => gate.release(reply));
		let waiting = false;
		f.responses.set("thread/read", () => {
			waiting = true;
			return gate.response;
		});
		f.notify("item/started", {
			threadId,
			turnId: "past-turn",
			item: {
				id: "child-start",
				type: "subAgentActivity",
				agentThreadId: "child",
				agentPath: "child",
				kind: "started",
			},
		});
		await until(() => waiting);
		if (changed) {
			f.notify("thread/status/changed", {
				threadId: "child",
				status: { type: "systemError" },
			});
			await until(
				() =>
					f.controller.snapshot().agents[0]?.status === "systemError",
			);
		}

		gate.release(reply);
		await until(
			() =>
				f.controller.snapshot().agents[0]?.nickname === "取得した名前",
		);
		assert.equal(
			f.controller.snapshot().agents[0]!.status,
			changed ? "systemError" : "idle",
		);
		assert.equal(f.controller.snapshot().sessionId, threadId);
	});
}

void test("Codex の子閲覧中に親会話を切り替えても、遅い履歴を公開せず新しい会話を保持する", async (t) => {
	const f = await historyFixture(t);
	f.notify("item/started", {
		threadId: f.controller.snapshot().sessionId,
		turnId: "past-turn",
		item: {
			id: "child-start",
			type: "subAgentActivity",
			agentThreadId: "child",
			agentPath: "child",
			kind: "started",
		},
	});
	await until(() => f.controller.snapshot().agents.length === 1);
	const gate = codexResponseGate();
	const original = f.responses.get("thread/items/list")!;
	t.after(() => gate.release({ data: [], nextCursor: null }));
	let waiting = false;
	f.responses.set("thread/items/list", (request) => {
		if (request.params!.threadId === "child") {
			waiting = true;
			return gate.response;
		}
		return original(request);
	});
	const requestId = randomUUID();
	const pending = f.controller.receive({
		type: "agent/read",
		requestId,
		sessionId: f.controller.snapshot().sessionId!,
		threadId: "child",
	});
	await until(() => waiting);

	await f.controller.receive({
		type: "session/new",
		requestId: randomUUID(),
	});
	const sessionId = f.controller.snapshot().sessionId;
	gate.release({
		data: [
			{
				turnId: "first",
				item: { id: "late", type: "agentMessage", text: "旧会話の子" },
			},
		],
		nextCursor: null,
	});
	await pending;
	assert.equal(f.controller.snapshot().sessionId, sessionId);
	assert.deepEqual(f.controller.snapshot().agents, []);
	assert.deepEqual(f.controller.snapshot().messages, []);
	assert.ok(
		!f.events.some(
			(event) =>
				event.type === "agent/view" && event.requestId === requestId,
		),
	);
});

void test("Codex のページ取得中に切断した場合は遅い復元結果を公開しない", async (t) => {
	const f = await historyFixture(t);
	const original = f.responses.get("thread/items/list")!;
	f.responses.set("thread/items/list", (request) => {
		if (Boolean(request.params!.cursor)) {
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
				Boolean(request.params!.cursor),
		),
	);
});

void test("Codex の履歴復元後の設定取得中に切断しても、再接続の会話を保持して次の履歴操作を実行できる", async (t) => {
	const f = await historyFixture(t);
	const gate = codexResponseGate();
	t.after(() => gate.release({ data: [], nextCursor: null }));
	let waiting = false;
	f.responses.set("model/list", () => {
		waiting = true;
		return gate.response;
	});
	const restoring = historyAction(f.controller, "saved");
	await until(() => waiting);
	assert.equal(f.controller.snapshot().sessionId, "saved");
	assert.equal(f.controller.snapshot().sessionPending, true);
	const oldRef = f.controller.snapshot().tools[0]!.output!.outputRef!;
	f.controller.invalidate();
	f.responses.delete("model/list");
	await f.controller.connect();
	const sessionId = f.controller.snapshot().sessionId;
	assert.notEqual(sessionId, "saved");
	gate.release({ data: [], nextCursor: null });
	await restoring;
	assert.equal(f.controller.snapshot().connection, "ready");
	assert.equal(f.controller.snapshot().sessionId, sessionId);
	assert.equal(f.controller.snapshot().sessionPending, false);
	assert.equal(f.controller.snapshot().sessionsError, null);
	assert.deepEqual(f.controller.snapshot().tools, []);
	assert.equal(
		f.controller
			.snapshot()
			.configOptions.find((option) => option.id === "model")
			?.currentValue,
		"model-a",
	);
	assert.ok(isNonEmptyString((await readTail(f.controller, oldRef)).error));
	await historyAction(f.controller, "broken");
	assert.equal(f.controller.snapshot().sessionId, "broken");
	assert.equal(f.controller.snapshot().sessionPending, false);
	assert.equal(
		(
			await readTail(
				f.controller,
				f.controller.snapshot().tools[0]!.output!.outputRef!,
			)
		).text,
		"末尾",
	);
});

void test("Codex の本文を一括で返す旧形式も出力参照へ変換して復元する", async (t) => {
	const f = await historyFixture(t);
	const attachmentPath = join(f.cwd, "育成素材.txt");
	const imagePath = join(f.cwd, "画像.png");
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
							id: "user",
							type: "userMessage",
							content: [
								{
									type: "text",
									text: "添付ファイル: この行はユーザー本文\n確認してください",
								},
								{
									type: "text",
									text: `添付ファイル: ${attachmentPath}\n大量の素材一覧`,
								},
								{ type: "localImage", path: imagePath },
							],
						},
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
	const user = f.controller
		.snapshot()
		.messages.find((message) => message.role === "user")!;
	assert.equal(
		user.text,
		"添付ファイル: この行はユーザー本文\n確認してください",
	);
	assert.deepEqual(
		user.attachments?.map(({ name, uri }) => ({ name, uri })),
		[
			{ name: "育成素材.txt", uri: pathToFileURL(attachmentPath).href },
			{ name: "画像.png", uri: pathToFileURL(imagePath).href },
		],
	);
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
