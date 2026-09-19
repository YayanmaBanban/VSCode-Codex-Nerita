// ページ境界・復元失敗・接続切替を含め、履歴操作が別の会話へ漏れないことを確認する。
import { afterEach, expect, it } from "vitest";
import { codexHarness, deferred, historyThread } from "./codexHarness";
import type { HistoryTurn } from "../../src/extension/codex/protocol/history";
import { isHostMessage, isUiMessage } from "../../src/shared/validation";

const harnesses: ReturnType<typeof codexHarness>[] = [];
afterEach(async () => {
	await Promise.all(
		harnesses.splice(0).map(({ session }) => session.dispose()),
	);
});
/** 一つの保存済み会話を一覧に用意する。 */
async function connected() {
	const h = codexHarness();
	harnesses.push(h);
	h.client.listThreads.mockResolvedValue({
		data: [historyThread()],
		nextCursor: null,
	});
	h.session.subscribe((event) => expect(isHostMessage(event)).toBe(true));
	await h.session.connect();
	return h;
}
/** 検証済みUIと同じ要求を新しいIDで送る。 */
const action = (
	h: ReturnType<typeof codexHarness>,
	type: string,
	extra: Record<string, unknown> = {},
) =>
	h.session.receive({
		type,
		requestId: crypto.randomUUID(),
		sessionId: "saved",
		...extra,
	});

for (const archived of [false, true]) {
	it(`永久削除はアーカイブAPIを呼ばず一覧を更新する: archived=${archived}`, async () => {
		const h = await connected();
		if (archived) {
			await action(h, "session/list", { archived: true });
		} else {
			await action(h, "session/load");
		}
		h.client.listThreads.mockResolvedValue({ data: [], nextCursor: null });
		await action(h, "session/delete");
		expect(h.client.deleteThread).toHaveBeenCalledWith("saved");
		expect(h.client.archiveThread).not.toHaveBeenCalled();
		expect(h.session.snapshot().sessions).toEqual([]);
		if (!archived) {
			expect(h.session.snapshot()).toMatchObject({
				sessionId: null,
				messages: [],
				configOptions: [],
			});
		}
	});
}

it("削除失敗では現在の会話を保持しエラーを表示する", async () => {
	const h = await connected();
	await action(h, "session/load");
	h.client.deleteThread.mockRejectedValueOnce(new Error("delete failed"));
	await action(h, "session/delete");
	expect(h.session.snapshot().sessionId).toBe("saved");
	expect(h.session.snapshot().sessionsError).toBeTruthy();
	expect(h.session.snapshot().sessionPending).toBe(false);
});
/** メッセージとコマンドの順序を確認する保存ターン。 */
function savedTurn(id = "old-turn"): HistoryTurn {
	return {
		id,
		status: "completed",
		itemsView: "full",
		items: [
			{
				id: "user",
				type: "userMessage",
				content: [{ type: "text", text: "質問" }],
			},
			{
				id: "cmd",
				type: "commandExecution",
				command: "echo test",
				cwd: "D:/workspace",
				status: "completed",
				aggregatedOutput: "test",
			},
			{ id: "agent", type: "agentMessage", text: "回答" },
		],
	};
}

it("一覧をcwdで絞り、次ページの重複を除外して循環カーソルを拒否する", async () => {
	const h = await connected();
	h.client.listThreads.mockResolvedValueOnce({
		data: [
			historyThread(),
			{ ...historyThread("other"), cwd: "D:/elsewhere" },
		],
		nextCursor: "page2",
	});
	await action(h, "session/list");
	expect(h.session.snapshot().sessions.map((s) => s.sessionId)).toEqual([
		"saved",
	]);
	h.client.listThreads.mockResolvedValueOnce({
		data: [historyThread(), historyThread("second")],
		nextCursor: "page3",
	});
	await action(h, "session/list", { more: true });
	expect(h.session.snapshot().sessions).toHaveLength(2);
	expect(h.client.listThreads).toHaveBeenLastCalledWith(
		expect.objectContaining({
			cwd: "D:/workspace",
			archived: false,
			cursor: "page2",
		}),
	);
	h.client.listThreads.mockResolvedValueOnce({
		data: [],
		nextCursor: "page2",
	});
	await action(h, "session/list", { more: true });
	expect(h.session.snapshot().sessionsError).toBeTruthy();
	expect(h.session.snapshot().sessions).toHaveLength(2);
});

it("legacy履歴を順番通りに復元し、同じthreadへ続けて送信する", async () => {
	const h = await connected();
	h.client.resumeThread.mockResolvedValueOnce({
		thread: { ...historyThread(), turns: [savedTurn()] },
		model: "restored-model",
		cwd: "D:/workspace",
	});
	await action(h, "session/load");
	const state = h.session.snapshot();
	expect(state.sessionId).toBe("saved");
	expect(state.messages.map((m) => [m.role, m.text, m.order])).toEqual([
		["user", "質問", 1],
		["assistant", "回答", 3],
	]);
	expect(state.tools[0]).toMatchObject({
		status: "completed",
		order: 2,
		rawOutput: { formatted_output: "test" },
	});
	expect(
		state.configOptions.find((o) => o.id === "model")?.currentValue,
	).toBe("restored-model");
	await h.send("続き");
	expect(h.client.startTurn).toHaveBeenLastCalledWith(
		expect.objectContaining({ threadId: "saved" }),
	);
});

it("paginated履歴と省略された項目を全ページ取得する", async () => {
	const h = await connected();
	const thread = { ...historyThread(), historyMode: "paginated" as const };
	h.client.readThread.mockResolvedValueOnce({ thread });
	h.client.resumeThread.mockResolvedValueOnce({
		thread,
		model: "test-model",
		cwd: thread.cwd,
	});
	h.client.listTurns
		.mockResolvedValueOnce({
			data: [{ ...savedTurn(), items: [], itemsView: "summary" }],
			nextCursor: "turns2",
		})
		.mockResolvedValueOnce({
			data: [savedTurn("second")],
			nextCursor: null,
		});
	h.client.listItems
		.mockResolvedValueOnce({
			data: [{ turnId: "old-turn", item: savedTurn().items[0]! }],
			nextCursor: "items2",
		})
		.mockResolvedValueOnce({
			data: savedTurn()
				.items.slice(1)
				.map((item) => ({ turnId: "old-turn", item })),
			nextCursor: null,
		});
	await action(h, "session/load");
	expect(h.client.resumeThread).toHaveBeenCalledWith("saved", true);
	expect(h.client.listTurns).toHaveBeenLastCalledWith("saved", "turns2");
	expect(h.client.listItems).toHaveBeenLastCalledWith(
		"saved",
		"old-turn",
		"items2",
	);
	expect(h.session.snapshot().messages).toHaveLength(4);
	expect(h.session.snapshot().tools).toHaveLength(2);
});

it("復元失敗は現在の会話と設定を保持し、遅い一覧で上書きしない", async () => {
	const h = await connected();
	await h.send();
	h.complete();
	await action(h, "session/list");
	const before = h.session.snapshot();
	h.client.resumeThread.mockResolvedValueOnce({
		thread: {
			...historyThread(),
			turns: [
				{
					...savedTurn(),
					items: [{ id: "bad", type: "agentMessage", text: 42 }],
				},
			],
		},
		model: "other",
		cwd: "D:/workspace",
	});
	await action(h, "session/load");
	expect(h.session.snapshot()).toMatchObject({
		sessionId: before.sessionId,
		messages: before.messages,
		configOptions: before.configOptions,
		sessionPending: false,
	});
	expect(h.session.snapshot().sessionsError).toBeTruthy();
});

it("名前変更・アーカイブ・解除はサーバーの結果を再取得する", async () => {
	const h = await connected();
	await action(h, "session/rename", { name: " 新しい名前 " });
	expect(h.client.renameThread).toHaveBeenCalledWith("saved", "新しい名前");
	await action(h, "session/load");
	await action(h, "session/archive");
	expect(h.client.archiveThread).toHaveBeenCalledWith("saved");
	expect(h.session.snapshot()).toMatchObject({
		sessionId: null,
		messages: [],
		tools: [],
	});
	await action(h, "session/list", { archived: true });
	await action(h, "session/unarchive");
	expect(h.client.unarchiveThread).toHaveBeenCalledWith("saved");
	expect(h.client.listThreads).toHaveBeenLastCalledWith(
		expect.objectContaining({ archived: true }),
	);
	await action(h, "session/new");
	expect(h.session.snapshot().sessionId).toBe("thread-2");
});

it("Forkは新しいIDを使い元の履歴を変更しない", async () => {
	const h = await connected();
	await action(h, "session/fork");
	expect(h.client.forkThread).toHaveBeenCalledWith("saved", false);
	expect(h.session.snapshot().sessionId).toBe("forked");
	expect(h.client.archiveThread).not.toHaveBeenCalled();
});

it("未知のID・別cwd・実行中の履歴は変更しない", async () => {
	const h = await connected();
	await action(h, "session/archive", { sessionId: "unknown" });
	expect(h.client.readThread).not.toHaveBeenCalled();
	for (const thread of [
		{ ...historyThread(), active: true },
		{ ...historyThread(), cwd: "D:/elsewhere" },
	]) {
		h.client.readThread.mockResolvedValueOnce({ thread });
		await action(h, "session/archive");
	}
	expect(h.client.archiveThread).not.toHaveBeenCalled();
	await h.send();
	await action(h, "session/load");
	expect(h.client.resumeThread).not.toHaveBeenCalled();
});

it("一覧切替と接続解除の後に届く古い応答を無視する", async () => {
	const h = await connected();
	const pending =
		deferred<Awaited<ReturnType<typeof h.client.listThreads>>>();
	h.client.listThreads.mockReturnValueOnce(pending.promise);
	const listing = action(h, "session/list");
	await action(h, "session/list", { archived: true });
	pending.resolve({ data: [historyThread("late")], nextCursor: "late" });
	await listing;
	expect(h.session.snapshot().sessionsArchived).toBe(true);
	expect(h.session.snapshot().sessions[0]?.sessionId).toBe("saved");
	await action(h, "session/list", { archived: false });
	const resume =
		deferred<Awaited<ReturnType<typeof h.client.resumeThread>>>();
	h.client.resumeThread.mockReturnValueOnce(resume.promise);
	const loading = action(h, "session/load");
	await Promise.resolve();
	h.session.invalidate();
	resume.resolve({
		thread: historyThread(),
		model: "late",
		cwd: "D:/workspace",
	});
	await loading;
	expect(h.session.snapshot()).toMatchObject({
		sessionId: null,
		connection: "disconnected",
		sessionPending: false,
	});
});

it("名前とページ指定の不正なUI入力を受け付けない", () => {
	expect(
		isUiMessage({
			type: "session/rename",
			requestId: "r",
			sessionId: "s",
			name: " ",
		}),
	).toBe(false);
	expect(
		isUiMessage({ type: "session/list", requestId: "r", more: "yes" }),
	).toBe(false);
});

it("一覧に未反映のForkをフィルター切替とアーカイブ解除でも保持する", async () => {
	const h = await connected();
	await action(h, "session/fork");
	await action(h, "session/list");
	expect(
		h.session.snapshot().sessions.some((s) => s.sessionId === "forked"),
	).toBe(true);
	await action(h, "session/archive", { sessionId: "forked" });
	await action(h, "session/list", { archived: true });
	expect(
		h.session.snapshot().sessions.find((s) => s.sessionId === "forked")
			?.archived,
	).toBe(true);
	await action(h, "session/unarchive", { sessionId: "forked" });
	await action(h, "session/list", { archived: false });
	expect(
		h.session.snapshot().sessions.some((s) => s.sessionId === "forked"),
	).toBe(true);
	h.client.listThreads.mockResolvedValue({
		data: [historyThread("forked")],
		nextCursor: null,
	});
	await action(h, "session/list");
	expect(h.session.snapshot().sessions).toHaveLength(1);
	h.client.listThreads.mockResolvedValue({ data: [], nextCursor: null });
	await action(h, "session/list");
	expect(h.session.snapshot().sessions).toHaveLength(0);
});

it("復元中の二重操作と外部ターン開始を拒否する", async () => {
	const h = await connected();
	const response =
		deferred<Awaited<ReturnType<typeof h.client.resumeThread>>>();
	h.client.resumeThread.mockReturnValueOnce(response.promise);
	const before = h.session.snapshot().sessionId;
	const loading = action(h, "session/load");
	await Promise.resolve();
	await action(h, "session/archive");
	expect(h.client.archiveThread).not.toHaveBeenCalled();
	h.notify("turn/started", {
		threadId: "saved",
		turn: { id: "external", status: "inProgress", items: [] },
	});
	response.resolve({
		thread: historyThread(),
		model: "test-model",
		cwd: "D:/workspace",
	});
	await loading;
	expect(h.session.snapshot().sessionId).toBe(before);
	expect(h.session.snapshot().sessionsError).toBeTruthy();
});
