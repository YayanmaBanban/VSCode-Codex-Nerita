// 要約専用 App Server の JSONL 通信を通し、親への送信と生成中 Stop・生成失敗を検証する。
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { HostMessage } from "@nerita/shared/messages";
import type { ChatState } from "@nerita/shared/chatState";
import { codexFixture } from "../support/codex";
import { until } from "../support/pi";

type Fixture = Awaited<ReturnType<typeof codexFixture>>;
type Controller = ReturnType<Fixture["controller"]>;

for (const outcome of ["completed", "failed", "stop"] as const) {
	void test(`Codex のハンドオフ生成 ${outcome} で親の送信と原文保持を区別する`, (t) =>
		verifyHandoff(t, outcome));
}

/** App Server を子プロセスで代替し、製品の要約・取り消し処理と実際のプロセス間通信を使う。 */
async function verifyHandoff(
	t: TestContext,
	outcome: "completed" | "failed" | "stop",
) {
	const f = await handoffFixture(t);
	const controller = f.controller();
	const events: HostMessage[] = [];
	controller.subscribe((event) => events.push(event));
	await controller.connect();
	const sessionId = controller.snapshot().sessionId!;
	const before = controller.snapshot().messages;
	const sending = controller.receive({
		type: "prompt/send",
		requestId: "handoff",
		sessionId,
		text: "引継ぎの作業",
		sessionReferences: [{ sessionId: "source", mode: "handoff" }],
	});
	try {
		await until(
			() => f.requests.some((request) => request.method === "turn/start"),
			() => ({ state: controller.snapshot(), requests: f.requests }),
		);
		verifyGenerationRequest(f);
		if (outcome === "stop") {
			await controller.receive({
				type: "prompt/cancel",
				requestId: "stop",
				sessionId,
				runId: controller.snapshot().runId!,
			});
		} else {
			f.notify("item/completed", {
				threadId: "thread-2",
				turnId: "turn-1",
				item: {
					id: "summary",
					type: "agentMessage",
					text: "引継ぎ用の要約",
				},
			});
			f.notify("turn/completed", {
				threadId: "thread-2",
				turn: { id: "turn-1", status: outcome, items: [] },
			});
		}
		await sending;
	} finally {
		// アサーションが失敗しても、要約専用プロセスの応答待ちを終了させる。
		if (controller.snapshot().run === "running") {
			await controller.receive({
				type: "prompt/cancel",
				requestId: "cleanup",
				sessionId,
				runId: controller.snapshot().runId!,
			});
		}
		await sending;
	}
	verifyFinalState(f, controller, events, before, sessionId, outcome);
}

/** 読取り RPC へ元の会話を返し、再開・フォークを介さず参照する。 */
async function handoffFixture(t: TestContext) {
	const f = await codexFixture(t);
	f.responses.set("thread/read", () => ({
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
							text: "参照元だけの回答",
						},
					],
				},
			],
		},
	}));
	return f;
}

/** 完了した要約だけを追加コンテキストへ渡し、失敗・停止時は親と原文を保持する。 */
function verifyFinalState(
	f: Fixture,
	controller: Controller,
	events: HostMessage[],
	before: ChatState["messages"],
	sessionId: string,
	outcome: string,
) {
	const starts = f.requests.filter(
		(request) => request.method === "turn/start",
	);
	if (outcome === "completed") {
		assert.equal(starts.length, 2);
		assert.equal(starts[1]!.params?.threadId, sessionId);
		assert.ok(
			JSON.stringify(starts[1]!.params?.additionalContext).includes(
				"引継ぎ用の要約",
			),
		);
		assert.ok(
			!JSON.stringify(starts[1]!.params?.additionalContext).includes(
				"参照元だけの回答",
			),
		);
		assert.ok(
			events.some(
				(event) =>
					event.type === "prompt/accepted" &&
					event.requestId === "handoff",
			),
		);
	} else {
		assert.equal(
			starts.length,
			1,
			"生成失敗・Stop では親ターンを開始しない",
		);
		assert.deepEqual(controller.snapshot().messages, before);
		assert.ok(
			events.some(
				(event) =>
					event.type === "request/failed" &&
					event.requestId === "handoff",
			),
		);
		assert.ok(
			!events.some(
				(event) =>
					event.type === "prompt/accepted" &&
					event.requestId === "handoff",
			),
		);
	}
	assert.equal(controller.snapshot().sessionId, sessionId);
	assert.equal(
		f.requests.filter((request) => request.method === "thread/resume")
			.length,
		0,
	);
	assert.equal(
		f.requests.filter((request) => request.method === "thread/fork").length,
		0,
	);
}

/** 要約は固定モデルと無承認・読取り専用の一時会話を使う。 */
function verifyGenerationRequest(f: Awaited<ReturnType<typeof codexFixture>>) {
	const start = f.requests.find(
		(request) =>
			request.method === "thread/start" && request.params?.ephemeral,
	);
	assert.ok(start);
	assert.equal(start.params?.sandbox, "read-only");
	assert.equal(start.params?.approvalPolicy, "never");
	assert.deepEqual(start.params?.config, {
		tools: { shell: false },
		web_search: "disabled",
	});
	const input = f.requests.find(
		(request) => request.method === "turn/start",
	)!.params;
	assert.equal(input?.threadId, "thread-2");
	assert.ok(JSON.stringify(input?.input).includes("untrusted_conversation"));
	assert.ok(JSON.stringify(input?.input).includes("参照元だけの回答"));
}
