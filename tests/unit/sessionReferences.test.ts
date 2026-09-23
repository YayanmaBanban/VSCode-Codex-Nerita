// セッション参照の取得境界と、実際の送信先・追加コンテキストを検証する。
import { afterEach, expect, it, vi } from "vitest";
import { codexHarness, deferred, historyThread } from "./codexHarness";
import type { HistoryTurn } from "../../src/extension/backends/codex/protocol/history";
import type { HostMessage } from "../../src/shared/messages";
import { readSessionContext } from "../../src/extension/backends/codex/context/sessionContext";
import { isHostMessage } from "../../src/shared/hostMessageValidation";
import { isUiMessage } from "../../src/shared/uiMessageValidation";
import { pathText, validReferences } from "../../src/shared/composerReferences";

const preview = vi.hoisted(() => ({
	open: vi.fn().mockResolvedValue({}),
	show: vi.fn(),
}));
vi.mock("vscode", () => ({
	workspace: { openTextDocument: preview.open },
	window: { showTextDocument: preview.show },
	ViewColumn: { Active: -1 },
}));
const harnesses: ReturnType<typeof codexHarness>[] = [];
afterEach(async () => {
	await Promise.all(
		harnesses.splice(0).map(({ session }) => session.dispose()),
	);
});
/** 本文とツール出力を区別する保存会話。 */
function savedTurn(text = "以前の回答"): HistoryTurn {
	return {
		id: "old-turn",
		status: "completed",
		itemsView: "full",
		items: [
			{
				id: "user",
				type: "userMessage",
				content: [{ type: "text", text: "以前の質問" }],
			},
			{ id: "agent", type: "agentMessage", text },
		],
	};
}
/** 参照先は現在の会話とは別のIDで保持する。 */
async function connected() {
	const h = codexHarness();
	harnesses.push(h);
	await h.session.connect();
	h.client.readThread.mockImplementation((id) =>
		Promise.resolve({
			thread: { ...historyThread(id), turns: [savedTurn()] },
		}),
	);
	return h;
}
/** 送信受付と失敗の通知を追跡する。 */
function events(h: ReturnType<typeof codexHarness>) {
	const received: HostMessage[] = [];
	h.session.subscribe((message) => {
		expect(isHostMessage(message)).toBe(true);
		received.push(message);
	});
	return received;
}
it("検索は指定の取得元・cwd・順序・カーソルを維持し履歴パネルを変更しない", async () => {
	const h = await connected();
	const received = events(h);
	const before = h.session.snapshot();
	h.client.listThreads.mockResolvedValue({
		data: [
			historyThread("b"),
			historyThread("a"),
			historyThread(before.sessionId!),
			{ ...historyThread("outside"), cwd: "D:/elsewhere" },
		],
		nextCursor: "next",
	});
	await h.session.receive({
		type: "session/searchReferences",
		requestId: "search",
		query: "実装",
		cursor: "first",
	});
	expect(h.client.listThreads).toHaveBeenLastCalledWith(
		expect.objectContaining({
			cwd: "D:/workspace",
			sourceKinds: ["cli", "vscode", "exec", "appServer", "unknown"],
			searchTerm: "実装",
			cursor: "first",
			sortKey: "updated_at",
			sortDirection: "desc",
		}),
	);
	expect(received.at(-1)).toMatchObject({
		type: "session/references",
		entries: [{ sessionId: "b" }, { sessionId: "a" }],
		nextCursor: "next",
	});
	expect(h.session.snapshot()).toEqual(before);
});
it("通常送信では選択した会話だけをuntrustedで渡し、参照元を再開しない", async () => {
	const h = await connected();
	await h.session.receive({
		type: "prompt/send",
		requestId: "send",
		sessionId: h.session.snapshot().sessionId,
		text: "この方針で",
		referencedSessionIds: ["saved", "saved"],
	});
	const params = h.client.startTurn.mock.calls[0]![0];
	expect(params.threadId).toBe("thread-1");
	expect(params.input[0]).toMatchObject({ text: "この方針で" });
	expect(
		params.additionalContext?.["referenced_session:saved"],
	).toMatchObject({
		kind: "untrusted",
		value: expect.stringContaining("以前の回答") as unknown,
	});
	expect(Object.keys(params.additionalContext!)).toHaveLength(1);
	expect(h.client.readThread).toHaveBeenCalledWith("saved", true);
	expect(h.client.resumeThread).not.toHaveBeenCalled();
	expect(h.session.snapshot().messages[0]?.text).toBe("この方針で");
});
it("フォローアップでも参照を渡し、読み込み中に完了したら通常送信へ切り替える", async () => {
	const h = await connected();
	await h.send();
	await h.session.receive({
		type: "prompt/send",
		requestId: "steer",
		sessionId: "thread-1",
		text: "参照して",
		referencedSessionIds: ["saved"],
	});
	expect(h.client.steerTurn).toHaveBeenCalledWith(
		expect.objectContaining({
			additionalContext: {
				"referenced_session:saved": {
					kind: "untrusted",
					value: expect.stringContaining("以前の質問") as unknown,
				},
			},
		}),
	);
	const pending = deferred<Awaited<ReturnType<typeof h.client.readThread>>>();
	h.client.readThread.mockReturnValueOnce(pending.promise);
	const sending = h.session.receive({
		type: "prompt/send",
		requestId: "next",
		sessionId: "thread-1",
		text: "次",
		referencedSessionIds: ["saved"],
	});
	h.complete();
	pending.resolve({ thread: historyThread() });
	await sending;
	expect(h.client.startTurn).toHaveBeenCalledTimes(2);
	expect(h.client.steerTurn).toHaveBeenCalledTimes(1);
});
it("削除・別cwd・実行中・現在の会話への参照は送信せず下書き用の失敗通知を返す", async () => {
	for (const thread of [
		null,
		{ ...historyThread(), cwd: "D:/other" },
		{ ...historyThread(), active: true },
	]) {
		const h = await connected();
		const received = events(h);
		if (thread) {
			h.client.readThread.mockResolvedValue({ thread });
		} else {
			h.client.readThread.mockRejectedValue(new Error("deleted"));
		}
		await h.session.receive({
			type: "prompt/send",
			requestId: "failed",
			sessionId: "thread-1",
			text: "参照して",
			referencedSessionIds: ["saved"],
		});
		expect(h.client.startTurn).not.toHaveBeenCalled();
		expect(received.at(-1)).toMatchObject({
			type: "request/failed",
			error: expect.stringContaining("参照セッション") as unknown,
		});
		expect(h.session.snapshot().messages).toEqual([]);
	}
	const h = await connected();
	await h.session.receive({
		type: "prompt/send",
		requestId: "self",
		sessionId: "thread-1",
		text: "自分",
		referencedSessionIds: ["thread-1"],
	});
	expect(h.client.readThread).not.toHaveBeenCalled();
});
it("古い接続の参照結果は送信しない", async () => {
	const h = await connected();
	const pending = deferred<Awaited<ReturnType<typeof h.client.readThread>>>();
	h.client.readThread.mockReturnValueOnce(pending.promise);
	const sending = h.session.receive({
		type: "prompt/send",
		requestId: "old",
		sessionId: "thread-1",
		text: "参照",
		referencedSessionIds: ["saved"],
	});
	h.session.invalidate();
	pending.resolve({ thread: historyThread() });
	await sending;
	expect(h.client.startTurn).not.toHaveBeenCalled();
});
it("ページ履歴を読み、古い本文の省略と取得上限を明示する", async () => {
	const h = await connected();
	h.client.readThread.mockResolvedValue({
		thread: { ...historyThread(), historyMode: "paginated" },
	});
	h.client.listTurns.mockResolvedValue({
		data: [savedTurn(`${"a".repeat(41_000)}末尾`)],
		nextCursor: null,
	});
	const text = await readSessionContext(
		h.client,
		"saved",
		"D:/workspace",
		() => true,
	);
	expect(text).toContain("Earlier content omitted");
	expect(text.endsWith("末尾")).toBe(true);
	h.client.listTurns.mockResolvedValue({
		data: [savedTurn()],
		nextCursor: "loop",
	});
	await expect(
		readSessionContext(h.client, "saved", "D:/workspace", () => true),
	).rejects.toThrow();
});
it("チップの内容表示はVS Codeに開き、現在の会話を切り替えない", async () => {
	const h = await connected();
	const before = h.session.snapshot();
	await h.session.receive({
		type: "session/openReference",
		requestId: "open",
		referencedSessionId: "saved",
	});
	expect(preview.open).toHaveBeenCalledWith({
		language: "plaintext",
		content: expect.stringContaining("以前の質問") as unknown,
	});
	expect(preview.show).toHaveBeenCalled();
	expect(h.session.snapshot()).toEqual(before);
});
it("参照型の保存・復元と送信数の上限を検証する", () => {
	const reference = {
		kind: "session" as const,
		sessionId: "saved",
		name: "以前の会話",
		cwd: "D:/workspace",
	};
	expect(
		validReferences(pathText(reference), [{ offset: 0, path: reference }]),
	).toBe(true);
	expect(
		validReferences(pathText(reference), [
			{ offset: 0, path: { ...reference, sessionId: "" } },
		]),
	).toBe(false);
	expect(
		isUiMessage({
			type: "prompt/send",
			requestId: "x",
			sessionId: "now",
			text: "hello",
			referencedSessionIds: Array(6).fill("saved"),
		}),
	).toBe(false);
	expect(
		isUiMessage({
			type: "session/searchReferences",
			requestId: "x",
			query: "x".repeat(257),
		}),
	).toBe(false);
});
