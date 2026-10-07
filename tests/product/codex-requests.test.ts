// サーバー発の承認・対話を本番の JSONL 通信へ届け、ターンの照合と取り消しを検証する。
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { codexFixture, codexResponseGate, type Rpc } from "../support/codex";
import { until } from "../support/pi";

type Fixture = Awaited<ReturnType<typeof codexFixture>>;
type Controller = ReturnType<Fixture["controller"]>;

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

/** 要求 ID に対応するクライアントの応答を待ち、準備失敗を取り消しの結果と取り違えない。 */
async function reply(f: Fixture, id: number): Promise<unknown> {
	await until(() => f.clientResponses.some((response) => response.id === id));
	const response = f.clientResponses.find((entry) => entry.id === id)!;
	assert.equal(response.error, undefined);
	return response.result;
}

for (const [method, title, decision] of [
	["item/commandExecution/requestApproval", "コマンド実行の承認", "accept"],
	["item/fileChange/requestApproval", "ファイル変更の承認", "decline"],
]) {
	void test(`Codex の開始応答前の${title}は対象ターンの確定後に表示し、${decision}を一度だけ返す`, async (t) => {
		const f = await codexFixture(t);
		const controller = f.controller();
		await controller.connect();
		const gate = codexResponseGate();
		const started = { turn: { id: "turn-1", status: "inProgress" } };
		t.after(() => gate.release(started));
		let waiting = false;
		f.responses.set("turn/start", () => {
			waiting = true;
			return gate.response;
		});
		const sending = action(controller, "prompt/send", { text: "変更する" });
		await until(() => waiting);
		const threadId = controller.snapshot().sessionId;
		const id = f.serverRequest(method!, {
			threadId,
			turnId: "turn-1",
			itemId: "tool-1",
			command: "fixture command",
			cwd: f.cwd,
			reason: "変更の確認",
		});
		// 後続通知の適用を待ち、承認が開始応答を待っていることを確認する。
		f.notify("thread/tokenUsage/updated", {
			threadId,
			tokenUsage: { last: { totalTokens: 1 }, modelContextWindow: 100 },
		});
		await until(() => controller.snapshot().usage?.used === 1);
		assert.deepEqual(controller.snapshot().permissions, []);
		assert.ok(!f.clientResponses.some((response) => response.id === id));

		gate.release(started);
		await sending;
		await until(() => controller.snapshot().permissions.length === 1);
		const permission = controller.snapshot().permissions[0]!;
		assert.equal(permission.title, title);
		assert.equal(permission.command, "fixture command");
		assert.equal(permission.cwd, f.cwd);
		await action(controller, "permission/respond", {
			permissionId: permission.id,
			optionId: decision,
		});
		assert.deepEqual(await reply(f, id), { decision });
		assert.deepEqual(controller.snapshot().permissions, []);
		await action(controller, "permission/respond", {
			permissionId: permission.id,
			optionId: "accept",
		});
		assert.equal(
			f.clientResponses.filter((entry) => entry.id === id).length,
			1,
		);
	});
}

void test("Codex は別スレッドと終了済みターンの承認を表示せず、次のターンへ持ち越さない", async (t) => {
	const f = await codexFixture(t);
	const controller = f.controller();
	await controller.connect();
	await action(controller, "prompt/send", { text: "最初の指示" });
	const threadId = controller.snapshot().sessionId;
	for (const scope of [
		{ threadId: "other", turnId: "turn-1" },
		{ threadId, turnId: "past-turn" },
	]) {
		const id = f.serverRequest("item/commandExecution/requestApproval", {
			...scope,
			itemId: "tool-1",
		});
		assert.deepEqual(await reply(f, id), { decision: "cancel" });
		assert.deepEqual(controller.snapshot().permissions, []);
	}
	f.notify("turn/completed", {
		threadId,
		turn: { id: "turn-1", status: "completed", items: [] },
	});
	await until(() => controller.snapshot().run === "completed");
	for (const nextTurn of [false, true]) {
		if (nextTurn) {
			await action(controller, "prompt/send", { text: "次の指示" });
		}
		const id = f.serverRequest("item/commandExecution/requestApproval", {
			threadId,
			turnId: "turn-1",
			itemId: "tool-1",
		});
		assert.deepEqual(await reply(f, id), { decision: "cancel" });
		assert.deepEqual(controller.snapshot().permissions, []);
	}
});

void test("Codex は開始応答前の停止で承認を取り消し、確定したターンへ停止を一度だけ送る", async (t) => {
	const f = await codexFixture(t);
	const controller = f.controller();
	await controller.connect();
	const gate = codexResponseGate();
	const started = { turn: { id: "turn-1", status: "inProgress" } };
	t.after(() => gate.release(started));
	let waiting = false;
	f.responses.set("turn/start", () => {
		waiting = true;
		return gate.response;
	});
	const sending = action(controller, "prompt/send", { text: "停止する" });
	await until(() => waiting);
	const threadId = controller.snapshot().sessionId;
	const id = f.serverRequest("item/commandExecution/requestApproval", {
		threadId,
		turnId: "turn-1",
		itemId: "tool-1",
	});
	f.notify("turn/started", {
		threadId,
		turn: { ...started.turn, items: [] },
	});
	f.notify("thread/tokenUsage/updated", {
		threadId,
		tokenUsage: { last: { totalTokens: 1 }, modelContextWindow: 100 },
	});
	await until(() => controller.snapshot().usage?.used === 1);
	await action(controller, "prompt/cancel");
	assert.equal(controller.snapshot().run, "cancelling");
	gate.release(started);
	await sending;
	assert.deepEqual(await reply(f, id), { decision: "cancel" });
	const isInterrupt = (request: Rpc) => request.method === "turn/interrupt";
	await until(() => f.requests.some(isInterrupt));
	assert.deepEqual(controller.snapshot().permissions, []);
	const interrupts = f.requests.filter(isInterrupt);
	assert.equal(interrupts.length, 1);
	assert.deepEqual(interrupts[0]!.params, { threadId, turnId: "turn-1" });
	f.notify("turn/completed", {
		threadId,
		turn: { id: "turn-1", status: "interrupted", items: [] },
	});
	await until(() => controller.snapshot().run === "cancelled");
});

void test("Codex は開始通知まで停止の送信を待ち、停止応答では実行を終了しない", async (t) => {
	const f = await codexFixture(t);
	const controller = f.controller();
	await controller.connect();
	await action(controller, "prompt/send", { text: "開始通知が遅い実行" });
	const threadId = controller.snapshot().sessionId;
	const gate = codexResponseGate();
	t.after(() => gate.release({}));
	let interruptReplied = false;
	f.responses.set("turn/interrupt", async () => {
		await gate.response;
		interruptReplied = true;
		return {};
	});
	await action(controller, "prompt/cancel");
	assert.equal(controller.snapshot().run, "cancelling");
	// 子プロセスとの通信を進めても、開始通知なしには停止を送らない。
	await setTimeout(75);
	const isInterrupt = (request: Rpc) => request.method === "turn/interrupt";
	assert.equal(f.requests.filter(isInterrupt).length, 0);
	const started = {
		threadId,
		turn: { id: "turn-1", status: "inProgress", items: [] },
	};
	f.notify("turn/started", started);
	await until(() => f.requests.some(isInterrupt));
	f.notify("turn/started", started);
	await action(controller, "prompt/cancel");
	f.notify("thread/name/updated", { threadId, threadName: "停止受付待ち" });
	await until(() => controller.snapshot().sessionTitle === "停止受付待ち");
	assert.equal(f.requests.filter(isInterrupt).length, 1);
	assert.deepEqual(f.requests.find(isInterrupt)!.params, {
		threadId,
		turnId: "turn-1",
	});
	gate.release({});
	await until(() => interruptReplied);
	await setTimeout(75);
	assert.equal(controller.snapshot().run, "cancelling");
	f.notify("turn/completed", {
		threadId,
		turn: { id: "turn-1", status: "interrupted", items: [] },
	});
	await until(() => controller.snapshot().run === "cancelled");
	await action(controller, "prompt/send", { text: "停止後に続ける" });
	assert.equal(controller.snapshot().sessionId, threadId);
	assert.equal(controller.snapshot().run, "running");
});

for (const cancellation of ["停止", "承認の中止", "ターンの完了"]) {
	void test(`Codex の表示中の承認は${cancellation}で消え、取消し結果を返す`, async (t) => {
		const f = await codexFixture(t);
		const controller = f.controller();
		await controller.connect();
		await action(controller, "prompt/send", { text: "承認待ち" });
		const threadId = controller.snapshot().sessionId;
		const id = f.serverRequest("item/commandExecution/requestApproval", {
			threadId,
			turnId: "turn-1",
			itemId: "tool-1",
		});
		await until(() => controller.snapshot().permissions.length === 1);
		const permissionId = controller.snapshot().permissions[0]!.id;
		if (cancellation === "停止") {
			await action(controller, "prompt/cancel");
		} else if (cancellation === "承認の中止") {
			await action(controller, "permission/respond", {
				permissionId,
				optionId: "cancel",
			});
		} else {
			f.notify("turn/completed", {
				threadId,
				turn: { id: "turn-1", status: "completed", items: [] },
			});
		}
		assert.deepEqual(await reply(f, id), { decision: "cancel" });
		assert.deepEqual(controller.snapshot().permissions, []);
		assert.equal(
			controller.snapshot().run,
			cancellation === "ターンの完了" ? "completed" : "cancelling",
		);
		if (cancellation !== "ターンの完了") {
			f.notify("turn/completed", {
				threadId,
				turn: { id: "turn-1", status: "interrupted", items: [] },
			});
			await until(() => controller.snapshot().run === "cancelled");
		}
	});
}

void test("Codex のサーバー側で解決した承認は表示から消え、遅い許可を返さない", async (t) => {
	const f = await codexFixture(t);
	const controller = f.controller();
	await controller.connect();
	await action(controller, "prompt/send", { text: "承認待ち" });
	const threadId = controller.snapshot().sessionId;
	const id = f.serverRequest("item/commandExecution/requestApproval", {
		threadId,
		turnId: "turn-1",
		itemId: "tool-1",
	});
	await until(() => controller.snapshot().permissions.length === 1);
	const permissionId = controller.snapshot().permissions[0]!.id;
	f.notify("serverRequest/resolved", { threadId, requestId: id });
	await until(() => controller.snapshot().permissions.length === 0);
	await action(controller, "permission/respond", {
		permissionId,
		optionId: "accept",
	});
	const marker = f.serverRequest("item/commandExecution/requestApproval", {
		threadId: "other",
		turnId: "turn-1",
		itemId: "marker",
	});
	assert.deepEqual(await reply(f, marker), { decision: "cancel" });
	assert.ok(!f.clientResponses.some((entry) => entry.id === id));
	assert.equal(controller.snapshot().run, "running");
});

void test("Codex は再接続前の承認を次の会話で受け付けず、新しい承認だけを返す", async (t) => {
	const f = await codexFixture(t);
	const controller = f.controller();
	await controller.connect();
	await action(controller, "prompt/send", { text: "旧会話" });
	const oldId = f.serverRequest("item/commandExecution/requestApproval", {
		threadId: controller.snapshot().sessionId,
		turnId: "turn-1",
		itemId: "old-tool",
	});
	await until(() => controller.snapshot().permissions.length === 1);
	const oldPermission = controller.snapshot().permissions[0]!.id;
	controller.invalidate();
	assert.deepEqual(controller.snapshot().permissions, []);
	await controller.connect();
	await action(controller, "prompt/send", { text: "新しい会話" });
	const id = f.serverRequest("item/commandExecution/requestApproval", {
		threadId: controller.snapshot().sessionId,
		turnId: "turn-2",
		itemId: "new-tool",
	});
	await until(() => controller.snapshot().permissions.length === 1);
	const permissionId = controller.snapshot().permissions[0]!.id;
	await action(controller, "permission/respond", {
		permissionId: oldPermission,
		optionId: "accept",
	});
	assert.equal(controller.snapshot().permissions[0]!.id, permissionId);
	assert.ok(!f.clientResponses.some((entry) => entry.id === id));
	await action(controller, "permission/respond", {
		permissionId,
		optionId: "accept",
	});
	assert.deepEqual(await reply(f, id), { decision: "accept" });
	const oldResponse = f.clientResponses.find((entry) => entry.id === oldId);
	if (oldResponse) {
		assert.deepEqual(oldResponse.result, { decision: "cancel" });
	}
});

for (const stopped of [false, true]) {
	void test(`Codex の質問を直列に表示し、停止後の入力と待機中の質問を返さない（停止=${stopped}）`, async (t) => {
		const f = await codexFixture(t);
		let release!: (answer: string) => void;
		const first = new Promise<string>((resolve) => {
			release = resolve;
		});
		t.after(() => release("終了時の入力"));
		const shown: string[] = [];
		const controller = f.controller(undefined, undefined, {
			input: async (title) => {
				shown.push(title);
				return shown.length === 1 ? first : "次の回答";
			},
			choose: () => {
				assert.fail("自由入力の質問を選択 UI へ渡さない");
			},
			open: () => {
				assert.fail("自由入力の質問で URL を開かない");
			},
		});
		await controller.connect();
		await action(controller, "prompt/send", { text: "質問を受ける" });
		const threadId = controller.snapshot().sessionId;
		const ids = ["最初の質問", "次の質問"].map((question) =>
			f.serverRequest("item/tool/requestUserInput", {
				threadId,
				turnId: "turn-1",
				itemId: "questions",
				questions: [{ id: "answer", question }],
			}),
		);
		f.notify("thread/tokenUsage/updated", {
			threadId,
			tokenUsage: { last: { totalTokens: 1 }, modelContextWindow: 100 },
		});
		await until(
			() => shown.length === 1 && controller.snapshot().usage?.used === 1,
		);
		assert.deepEqual(shown, ["最初の質問"]);
		if (stopped) {
			await action(controller, "prompt/cancel");
		}
		release("最初の回答");
		assert.deepEqual(
			await reply(f, ids[0]!),
			stopped
				? { answers: {} }
				: { answers: { answer: { answers: ["最初の回答"] } } },
		);
		assert.deepEqual(
			await reply(f, ids[1]!),
			stopped
				? { answers: {} }
				: { answers: { answer: { answers: ["次の回答"] } } },
		);
		assert.deepEqual(
			shown,
			stopped ? ["最初の質問"] : ["最初の質問", "次の質問"],
		);
		if (stopped) {
			f.notify("turn/completed", {
				threadId,
				turn: { id: "turn-1", status: "interrupted", items: [] },
			});
			await until(() => controller.snapshot().run === "cancelled");
		}
	});
}

for (const decision of ["accept", "decline"]) {
	void test(`Codex の追加権限を${decision}した結果は、このターンの要求範囲だけを返す`, async (t) => {
		const f = await codexFixture(t);
		const controller = f.controller();
		await controller.connect();
		await action(controller, "prompt/send", { text: "追加権限を要求する" });
		const permissions = { network: { enabled: true } };
		const id = f.serverRequest("item/permissions/requestApproval", {
			threadId: controller.snapshot().sessionId,
			turnId: "turn-1",
			itemId: "permissions",
			permissions,
			reason: "接続を許可する",
		});
		await until(() => controller.snapshot().permissions.length === 1);
		const permission = controller.snapshot().permissions[0]!;
		assert.equal(permission.title, "追加権限の承認（このターンのみ）");
		await action(controller, "permission/respond", {
			permissionId: permission.id,
			optionId: decision,
		});
		assert.deepEqual(await reply(f, id), {
			permissions: decision === "accept" ? permissions : {},
			scope: "turn",
		});
		assert.deepEqual(controller.snapshot().permissions, []);
	});
}
