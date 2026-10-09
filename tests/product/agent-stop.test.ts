// 閲覧中のエージェントとその子孫だけを停止し、親・兄弟や別セッションへ取消しを広げないことを検証する。
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { HostMessage } from "@nerita/shared/messages";
import type { PiSession } from "../../apps/vscode-nerita/src/extension/backends/pi/PiRuntime";
import { codexFixture } from "../support/codex";
import { piFixture, until } from "../support/pi";

void test(
	"Codex は子・孫だけへ中断を送り、親・兄弟と未知・古い要求を分離する",
	verifyCodexStop,
);
void test(
	"Pi は同じ接続の子・孫だけを取消し、兄弟のジョブを継続する",
	verifyPiStop,
);

/** 稼働中の親・子・孫・兄弟を App Server の通知で用意する。 */
async function codexStopFixture(t: TestContext) {
	const f = await codexFixture(t);
	const controller = f.controller();
	const events: HostMessage[] = [];
	t.after(controller.subscribe((event) => events.push(event)));
	await controller.connect();
	const root = controller.snapshot().sessionId!;
	const parents: Record<string, string> = {
		child: root,
		grandchild: "child",
		sibling: root,
	};
	f.responses.set("thread/read", ({ params }) => ({
		thread: {
			id: params!.threadId,
			parentThreadId: parents[z.string().parse(params!.threadId)],
			cwd: f.cwd,
			name: null,
			preview: "",
			updatedAt: 1,
			status: { type: "active" },
			historyMode: "paginated",
			turns: [],
		},
	}));
	f.responses.set("thread/turns/list", ({ params }) => ({
		data: [
			{
				id: `${z.string().parse(params!.threadId)}-turn`,
				status: "inProgress",
				itemsView: "summary",
				items: [],
			},
		],
		nextCursor: null,
	}));
	f.responses.set("turn/interrupt", () => ({}));
	await controller.receive({
		type: "prompt/send",
		requestId: randomUUID(),
		sessionId: root,
		text: "開始",
	});
	f.notify("turn/started", {
		threadId: root,
		turn: { id: "turn-1", status: "inProgress", items: [] },
	});
	for (const [id, parent] of Object.entries(parents)) {
		f.notify("item/started", {
			threadId: parent,
			turnId: parent === root ? "turn-1" : `${parent}-turn`,
			item: {
				id: `activity-${id}`,
				type: "subAgentActivity",
				agentThreadId: id,
				agentPath: `/root/${id}`,
				kind: "started",
			},
		});
		await until(() =>
			controller.snapshot().agents.some((agent) => agent.threadId === id),
		);
	}
	return { ...f, controller, events, root };
}

/** 不正な要求には RPC を送らず、正しい要求でも親と兄弟の稼働を保つ。 */
async function verifyCodexStop(t: TestContext) {
	const f = await codexStopFixture(t);
	const { controller, events, root } = f;
	for (const [sessionId, threadId] of [
		["old-session", "child"],
		[root, "unknown"],
		[root, root],
	]) {
		const requestId = randomUUID();
		await controller.receive({
			type: "agent/stop",
			requestId,
			sessionId: sessionId!,
			threadId: threadId!,
		});
		assert.ok(
			events.some(
				(event) =>
					event.type === "request/failed" &&
					event.requestId === requestId,
			),
		);
	}
	assert.equal(
		f.requests.filter((request) => request.method === "turn/interrupt")
			.length,
		0,
	);
	const requestId = randomUUID();
	await controller.receive({
		type: "agent/stop",
		requestId,
		sessionId: root,
		threadId: "child",
	});
	assert.deepEqual(
		f.requests
			.filter((request) => request.method === "turn/interrupt")
			.map((request) => request.params),
		[
			{ threadId: "child", turnId: "child-turn" },
			{ threadId: "grandchild", turnId: "grandchild-turn" },
		],
	);
	assert.ok(
		events.some(
			(event) =>
				event.type === "agent/stopped" && event.requestId === requestId,
		),
	);
	assert.equal(controller.snapshot().run, "running");
	assert.equal(
		controller
			.snapshot()
			.agents.find((agent) => agent.threadId === "sibling")!.status,
		"running",
	);
}

/** 親の応答がない期間も、同じ接続のジョブ群から対象の子孫だけを回収する。 */
async function verifyPiStop(t: TestContext) {
	const f = await piFixture(t);
	let runtime!: PiSession;
	const controller = f.controller((session) => {
		runtime = session;
	});
	const events: HostMessage[] = [];
	t.after(controller.subscribe((event) => events.push(event)));
	await controller.connect();
	const root = controller.snapshot().sessionId!;
	const views = runtime.agentViews!;
	const jobs = runtime.jobs!;
	const child = views.start("child", "child", "作業", f.cwd);
	const grandchild = views.start("grandchild", "grandchild", "作業", f.cwd);
	const sibling = views.start("sibling", "sibling", "作業", f.cwd);
	const abort = new AbortController();
	t.after(() => abort.abort());
	const ended: string[] = [];
	for (const [id, parentId] of [
		[child, root],
		[grandchild, child],
		[sibling, root],
	]) {
		void jobs
			.submit(
				{
					id: id!,
					parentId: parentId!,
					status: "queued",
					background: true,
					context: "fresh",
				},
				abort.signal,
				(signal) => waitForCancellation(signal, id!, ended),
			)
			.catch(() => undefined);
	}
	await until(() => jobs.list().every((job) => job.status === "running"));
	for (const [sessionId, threadId] of [
		["old-session", child],
		[root, "unknown"],
	]) {
		const requestId = randomUUID();
		await controller.receive({
			type: "agent/stop",
			requestId,
			sessionId: sessionId!,
			threadId: threadId!,
		});
		assert.ok(
			events.some(
				(event) =>
					event.type === "request/failed" &&
					event.requestId === requestId,
			),
		);
	}
	assert.deepEqual(ended, []);
	const requestId = randomUUID();
	await controller.receive({
		type: "agent/stop",
		requestId,
		sessionId: root,
		threadId: child,
	});
	assert.deepEqual(ended.sort(), [child, grandchild].sort());
	assert.equal(jobs.read(sibling).status, "running");
	assert.equal(jobs.read(child).status, "cancelled");
	assert.equal(jobs.read(grandchild).status, "cancelled");
	assert.equal(controller.snapshot().sessionId, root);
	assert.equal(controller.snapshot().run, "idle");
	assert.ok(
		events.some(
			(event) =>
				event.type === "agent/stopped" && event.requestId === requestId,
		),
	);
}

/** SDK の応答待ちだけを代替し、取消シグナルが届いた対象を記録する。 */
function waitForCancellation(
	signal: AbortSignal,
	id: string,
	ended: string[],
): Promise<void> {
	return new Promise((resolve) => {
		signal.addEventListener(
			"abort",
			() => {
				ended.push(id);
				resolve();
			},
			{ once: true },
		);
	});
}
