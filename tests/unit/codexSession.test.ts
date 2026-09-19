// App Server の開始受付・完了通知・停止・再接続を実行世代ごとに検証する。
import { afterEach, expect, it, vi } from "vitest";
import { isHostMessage } from "../../src/shared/hostMessageValidation";
import { codexHarness, deferred } from "./codexHarness";
import type { CodexSessionController } from "../../src/extension/codex/CodexSessionController";

const sessions: CodexSessionController[] = [];
afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(sessions.splice(0).map((session) => session.dispose()));
});
/** 接続済みのテスト用会話を作る。 */
async function connected() {
	const harness = codexHarness();
	sessions.push(harness.session);
	harness.session.subscribe((event) =>
		expect(isHostMessage(event)).toBe(true),
	);
	await harness.session.connect();
	return harness;
}

it("開始受付後も running を維持し、delta と確定本文を重複させない", async () => {
	const { session, send, notify, complete, client } = await connected();
	await send();
	expect(client.startTurn).toHaveBeenCalledWith(
		expect.objectContaining({
			threadId: "thread-1",
			input: [{ type: "text", text: "hello", text_elements: [] }],
		}),
	);
	expect(session.snapshot().run).toBe("running");
	const scope = { threadId: "thread-1", turnId: "turn-1" };
	notify("item/agentMessage/delta", {
		...scope,
		itemId: "answer",
		delta: "こん",
	});
	notify("item/agentMessage/delta", {
		...scope,
		itemId: "answer",
		delta: "にちは",
	});
	notify("item/completed", {
		...scope,
		item: { type: "agentMessage", id: "answer", text: "こんにちは。" },
	});
	notify("item/agentMessage/delta", {
		...scope,
		itemId: "answer",
		delta: "must ignore",
	});
	complete();
	expect(session.snapshot().messages.map((message) => message.text)).toEqual([
		"hello",
		"こんにちは。",
	]);
	expect(session.snapshot().run).toBe("completed");
});

it("開始応答前の通知と Stop を保持し、停止通知後は同じ会話へ再送する", async () => {
	const { session, send, notify, cancel, complete, client } =
		await connected();
	const start = deferred<Awaited<ReturnType<typeof client.startTurn>>>();
	client.startTurn.mockReturnValueOnce(start.promise);
	const sending = send();
	const uiRunId = session.snapshot().runId;
	notify("item/agentMessage/delta", {
		threadId: "thread-1",
		turnId: "early",
		itemId: "answer",
		delta: "途中",
	});
	await cancel();
	expect(client.interruptTurn).not.toHaveBeenCalled();
	start.resolve({ turn: { id: "early", status: "inProgress" } });
	await sending;
	expect(client.interruptTurn).not.toHaveBeenCalled();
	notify("turn/started", {
		threadId: "thread-1",
		turn: { id: "early", status: "inProgress", items: [] },
	});
	expect(client.interruptTurn).toHaveBeenCalledExactlyOnceWith(
		"thread-1",
		"early",
	);
	expect(session.snapshot().runId).toBe(uiRunId);
	expect(session.snapshot().run).toBe("cancelling");
	expect(session.snapshot().messages.at(-1)?.text).toBe("途中");
	await send("must not send");
	expect(client.startTurn).toHaveBeenCalledTimes(1);
	complete("early", "interrupted");
	expect(session.snapshot().run).toBe("cancelled");
	await send("続けて");
	notify("turn/completed", {
		threadId: "thread-1",
		turn: { id: "early", status: "completed", items: [] },
	});
	expect(session.snapshot().run).toBe("running");
	expect(client.startThread).toHaveBeenCalledTimes(1);
	expect(
		session
			.snapshot()
			.messages.filter((message) => message.role === "user")
			.map((message) => message.text),
	).toEqual(["hello", "続けて"]);
});

it("完了通知が開始応答より先でも状態を running に戻さない", async () => {
	const { session, send, notify, client } = await connected();
	const start = deferred<Awaited<ReturnType<typeof client.startTurn>>>();
	client.startTurn.mockReturnValueOnce(start.promise);
	const sending = send();
	notify("turn/completed", {
		threadId: "thread-1",
		turn: {
			id: "early",
			status: "completed",
			items: [{ type: "agentMessage", id: "answer", text: "完了" }],
		},
	});
	start.resolve({ turn: { id: "early", status: "inProgress" } });
	await sending;
	expect(session.snapshot().run).toBe("completed");
	expect(session.snapshot().messages.at(-1)?.text).toBe("完了");
});

it("別 thread の通知・重複要求・古い実行への停止を拒否する", async () => {
	const { session, client, send, notify, complete } = await connected();
	const message = {
		type: "prompt/send",
		requestId: "once",
		sessionId: "thread-1",
		text: "hello",
	};
	await Promise.all([session.receive(message), session.receive(message)]);
	expect(client.startTurn).toHaveBeenCalledTimes(1);
	const oldRun = session.snapshot().runId;
	notify("item/agentMessage/delta", {
		threadId: "other",
		turnId: "turn-1",
		itemId: "a",
		delta: "wrong",
	});
	complete();
	await send("new");
	await session.receive({
		type: "prompt/cancel",
		requestId: "stale",
		sessionId: "thread-1",
		runId: oldRun,
	});
	expect(client.interruptTurn).not.toHaveBeenCalled();
	expect(session.snapshot().messages).toHaveLength(2);
});

it("新規会話は同じ接続を使い、作成失敗時には現在の履歴を残す", async () => {
	const { session, send, complete, client, factory } = await connected();
	await send();
	complete();
	client.startThread.mockRejectedValueOnce(new Error("unavailable"));
	await session.receive({ type: "session/new", requestId: "failed" });
	expect(session.snapshot().sessionId).toBe("thread-1");
	expect(session.snapshot().messages).toHaveLength(1);
	await session.receive({ type: "session/new", requestId: "next" });
	expect(session.snapshot().sessionId).toBe("thread-2");
	expect(session.snapshot().messages).toEqual([]);
	expect(factory).toHaveBeenCalledTimes(1);
});

it("切断中の遅い開始応答と旧接続の通知を適用しない", async () => {
	const { session, client, connections, send } = await connected();
	const old = connections[0]!;
	const start = deferred<Awaited<ReturnType<typeof client.startTurn>>>();
	client.startTurn.mockReturnValueOnce(start.promise);
	const sending = send();
	session.invalidate();
	expect(old.signal.aborted).toBe(true);
	await session.connect();
	start.resolve({ turn: { id: "late", status: "inProgress" } });
	await sending;
	old.callbacks.disconnected?.(new Error("old connection"));
	expect(session.snapshot().connection).toBe("ready");
	expect(session.snapshot().sessionId).toBe("thread-2");
	expect(session.snapshot().run).toBe("idle");
});

it("停止完了が来なければ期限で接続を回収する", async () => {
	const { session, send, cancel, client } = await connected();
	await send();
	vi.useFakeTimers();
	await cancel();
	await vi.advanceTimersByTimeAsync(10_000);
	expect(session.snapshot().connection).toBe("error");
	expect(session.snapshot().run).toBe("failed");
	expect(client.dispose).toHaveBeenCalled();
});

it("未認証の場合は会話を作らずログインを案内する", async () => {
	const { session, client } = codexHarness();
	sessions.push(session);
	client.readAccount.mockResolvedValue({
		authenticated: false,
		requiresOpenaiAuth: true,
	});
	await session.connect();
	expect(session.snapshot().connection).toBe("auth-required");
	expect(client.startThread).not.toHaveBeenCalled();
	expect(client.dispose).not.toHaveBeenCalled();
});
