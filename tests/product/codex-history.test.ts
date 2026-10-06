// ページ応答を子プロセスとの JSONL 通信へ流し、履歴の公開・出力取得・失敗時の保持を確認する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, type TestContext } from "node:test";
import type { HostMessage } from "@nerita/shared/messages";
import type { ToolOutputResponse } from "@nerita/shared/toolOutput";
import { codexFixture } from "../support/codex";
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
	assert.ok(isNonEmptyString((await readTail(f.controller, ref)).error));
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
