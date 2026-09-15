// 履歴のページング・切り替え・失敗・競合を Host の通信境界で検証する。
import { afterEach, expect, it, vi } from "vitest";
import type {
	ListSessionsResponse,
	LoadSessionResponse,
} from "@agentclientprotocol/sdk";
import { deferred, fixture } from "./fakeTransport";
import { sameCwd } from "../../src/extension/session/sessionCatalog";
import { isHostMessage, isUiMessage } from "../../src/shared/validation";
import { relativeTime } from "../../src/webview/chat/sessions/relativeTime";

const fixtures: ReturnType<typeof fixture>[] = [];
/** 一覧取得に対応する接続を作り、初期一覧を注入する。 */
async function setup() {
	const f = fixture({
		capabilities: {
			loadSession: true,
			sessionCapabilities: { list: {}, fork: {}, delete: {} },
		},
	});
	fixtures.push(f);
	const connecting = f.controller.connect();
	await Promise.resolve();
	const connection = f.connections[0]!;
	const items = [
		{
			sessionId: "one",
			cwd: process.cwd(),
			title: "会話1",
			updatedAt: "2026-09-15T00:00:00Z",
		},
		{
			sessionId: "two",
			cwd: process.cwd(),
			title: "会話2",
			updatedAt: "2026-09-15T01:00:00Z",
		},
	];
	vi.mocked(connection.transport.listSessions).mockResolvedValue({
		sessions: items,
	});
	await connecting;
	return { ...f, ...connection, items };
}
afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((f) => f.controller.dispose()));
});

it("起動時に一覧取得し、cwd を絞り込み、全ページを重複なく新しい順に並べる", async () => {
	const { controller, transport, items } = await setup();
	expect(transport.listSessions).toHaveBeenCalledTimes(1);
	vi.mocked(transport.listSessions)
		.mockResolvedValueOnce({
			sessions: [items[0]!, { sessionId: "other", cwd: "D:/other" }],
			nextCursor: "next",
		})
		.mockResolvedValueOnce({ sessions: [items[1]!, items[0]!] });
	await controller.receive({ type: "session/list", requestId: "list" });
	expect(transport.listSessions).toHaveBeenLastCalledWith("next");
	expect(
		controller.snapshot().sessions.map((item) => item.sessionId),
	).toEqual(["two", "one"]);
	expect(controller.snapshot().sessionsLoading).toBe(false);
	expect(sameCwd("D:\\Folder\\Project\\", "d:/folder/project")).toBe(true);
	expect(sameCwd("D:/project", "D:/project-other")).toBe(false);
	expect(
		isHostMessage({ type: "state/snapshot", state: controller.snapshot() }),
	).toBe(true);
});
it("読み込み応答前のユーザー・返信・ツールを順序通りに復元し、元の会話と混ぜない", async () => {
	const { controller, transport, callbacks } = await setup();
	vi.mocked(transport.loadSession).mockImplementation((sessionId) => {
		for (const [sessionUpdate, text] of [
			["user_message_chunk", "質問"],
			["agent_message_chunk", "回答"],
			["user_message_chunk", "次の質問"],
		] as const) {
			callbacks.update({
				sessionId,
				update: { sessionUpdate, content: { type: "text", text } },
			});
		}
		callbacks.update({
			sessionId,
			update: {
				sessionUpdate: "tool_call",
				toolCallId: "tool",
				title: "確認",
				status: "completed",
			},
		});
		callbacks.update({
			sessionId,
			update: {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "完了" },
			},
		});
		return Promise.resolve({});
	});
	await controller.receive({
		type: "session/load",
		requestId: "load",
		sessionId: "one",
	});
	const state = controller.snapshot();
	expect(state.sessionId).toBe("one");
	expect(state.messages.map((item) => [item.role, item.text])).toEqual([
		["user", "質問"],
		["assistant", "回答"],
		["user", "次の質問"],
		["assistant", "完了"],
	]);
	expect(state.tools[0]!.order).toBeLessThan(state.messages[3]!.order!);
	expect(state.run).toBe("idle");
	expect(state.sessionPending).toBe(false);
});
it("読み込み失敗時は以前の会話を維持し、失敗表示を一覧再取得で消さない", async () => {
	const { controller, transport, callbacks } = await setup();
	const before = controller.snapshot();
	vi.mocked(transport.loadSession).mockImplementation((sessionId) => {
		callbacks.update({
			sessionId,
			update: {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "不完全" },
			},
		});
		return Promise.reject(new Error("private diagnostic"));
	});
	await controller.receive({
		type: "session/load",
		requestId: "load",
		sessionId: "one",
	});
	expect(controller.snapshot().sessionId).toBe(before.sessionId);
	expect(controller.snapshot().messages).toEqual(before.messages);
	expect(controller.snapshot().sessionsError).toContain("読み込みに失敗");
	expect(controller.snapshot().sessionPending).toBe(false);
});
it("フォークの応答 ID を読み込み、作成後に一覧を更新する", async () => {
	const { controller, transport } = await setup();
	await controller.receive({
		type: "session/fork",
		requestId: "fork",
		sessionId: "one",
	});
	expect(transport.forkSession).toHaveBeenCalledWith("one");
	expect(transport.loadSession).toHaveBeenCalledWith("forked");
	expect(controller.snapshot().sessionId).toBe("forked");
	expect(transport.listSessions).toHaveBeenCalledTimes(2);
});
it("選択中の会話をアーカイブした後は送信対象を残さず、失敗時は一覧を維持する", async () => {
	const { controller, transport, items } = await setup();
	await controller.receive({
		type: "session/load",
		requestId: "load",
		sessionId: "one",
	});
	vi.mocked(transport.listSessions).mockResolvedValue({
		sessions: [items[1]!],
	});
	await controller.receive({
		type: "session/delete",
		requestId: "archive",
		sessionId: "one",
	});
	expect(transport.deleteSession).toHaveBeenCalledWith("one");
	expect(controller.snapshot().sessionId).toBeNull();
	expect(
		controller.snapshot().sessions.map((item) => item.sessionId),
	).toEqual(["two"]);
	vi.mocked(transport.deleteSession).mockRejectedValueOnce(
		new Error("failed"),
	);
	await controller.receive({
		type: "session/delete",
		requestId: "failed",
		sessionId: "two",
	});
	expect(controller.snapshot().sessions).toHaveLength(1);
	expect(controller.snapshot().sessionsError).toContain("アーカイブに失敗");
});
it("遅れた一覧応答・切断前の読み込み完了が新しい状態を上書きしない", async () => {
	const { controller, transport, items } = await setup();
	const delayed = deferred<ListSessionsResponse>();
	vi.mocked(transport.listSessions)
		.mockReturnValueOnce(delayed.promise)
		.mockResolvedValueOnce({ sessions: [] });
	const first = controller.receive({
		type: "session/list",
		requestId: "old",
	});
	await controller.receive({ type: "session/list", requestId: "new" });
	delayed.resolve({ sessions: items });
	await first;
	expect(controller.snapshot().sessions).toEqual([]);
	await controller.receive({ type: "session/list", requestId: "restore" });
	const loading = deferred<LoadSessionResponse>();
	vi.mocked(transport.loadSession).mockReturnValueOnce(loading.promise);
	const load = controller.receive({
		type: "session/load",
		requestId: "load",
		sessionId: "one",
	});
	controller.invalidate();
	loading.resolve({});
	await load;
	expect(controller.snapshot().sessionId).toBeNull();
	expect(controller.snapshot().sessions).toEqual([]);
	expect(controller.snapshot().sessionPending).toBe(false);
});
it("読み込み中の二重操作・送信と一覧外の ID を拒否する", async () => {
	const { controller, transport } = await setup();
	const loading = deferred<LoadSessionResponse>();
	vi.mocked(transport.loadSession).mockReturnValueOnce(loading.promise);
	const sessionId = controller.snapshot().sessionId!;
	const load = controller.receive({
		type: "session/load",
		requestId: "load",
		sessionId: "one",
	});
	await controller.receive({
		type: "session/fork",
		requestId: "fork",
		sessionId: "two",
	});
	await controller.receive({
		type: "prompt/send",
		requestId: "send",
		sessionId,
		text: "混在させない",
	});
	expect(transport.forkSession).not.toHaveBeenCalled();
	expect(transport.prompt).not.toHaveBeenCalled();
	loading.resolve({});
	await load;
	await controller.receive({
		type: "session/delete",
		requestId: "unknown",
		sessionId: "elsewhere",
	});
	expect(transport.deleteSession).not.toHaveBeenCalled();
});
it("非対応の接続先へ一覧要求を送らず、無効な通信値を拒否する", async () => {
	const f = fixture();
	fixtures.push(f);
	await f.controller.connect();
	await f.controller.receive({ type: "session/list", requestId: "list" });
	expect(f.connections[0]!.transport.listSessions).not.toHaveBeenCalled();
	expect(f.controller.snapshot().sessionsError).toContain("対応していません");
	expect(
		isUiMessage({ type: "session/load", requestId: "bad", sessionId: "" }),
	).toBe(false);
	expect(
		isHostMessage({
			type: "state/patch",
			revision: 1,
			patch: { sessions: [{ sessionId: "x", cwd: 123 }] },
		}),
	).toBe(false);
});
it("相対時刻は欠損・未来・分・時・日を扱う", () => {
	const now = Date.parse("2026-09-15T12:00:00Z");
	expect(relativeTime(undefined, now)).toBe("更新日時不明");
	expect(relativeTime("invalid", now)).toBe("更新日時不明");
	expect(relativeTime("2026-09-16T12:00:00Z", now)).toBe("たった今");
	expect(relativeTime("2026-09-15T11:58:00Z", now)).toBe("2分前");
	expect(relativeTime("2026-09-15T09:00:00Z", now)).toBe("3時間前");
	expect(relativeTime("2026-09-13T12:00:00Z", now)).toBe("2日前");
});

it("長い履歴の後に新しいターンを追加し、読み込み時のタスクも復元する", async () => {
	const { controller, transport, callbacks, result } = await setup();
	vi.mocked(transport.loadSession).mockImplementation((sessionId) => {
		for (let i = 0; i < 40; i++) {
			callbacks.update({
				sessionId,
				update: {
					sessionUpdate:
						i % 2 ? "agent_message_chunk" : "user_message_chunk",
					content: { type: "text", text: String(i) },
				},
			});
		}
		callbacks.asyncTask?.({
			sessionId,
			spawned: true,
			task: {
				asyncTaskId: "finished",
				state: "completed",
				canStop: false,
			},
		});
		return Promise.resolve({});
	});
	await controller.receive({
		type: "session/load",
		requestId: "load",
		sessionId: "one",
	});
	const lastOrder = controller.snapshot().messages.at(-1)!.order!;
	expect(controller.snapshot().asyncTasks[0]?.asyncTaskId).toBe("finished");
	const sending = controller.receive({
		type: "prompt/send",
		requestId: "send",
		sessionId: "one",
		text: "新しい質問",
	});
	expect(controller.snapshot().messages.at(-1)!.order).toBeGreaterThan(
		lastOrder,
	);
	callbacks.update({
		sessionId: "one",
		update: {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: "新しい回答" },
		},
	});
	expect(controller.snapshot().messages.at(-1)!.order).toBeGreaterThan(
		controller.snapshot().messages.at(-2)!.order!,
	);
	result.resolve({ stopReason: "end_turn" });
	await sending;
});
it("同じカーソルが繰り返された場合は取得を終了し、前回の一覧を残す", async () => {
	const { controller, transport, items } = await setup();
	vi.mocked(transport.listSessions).mockResolvedValue({
		sessions: [],
		nextCursor: "loop",
	});
	await controller.receive({ type: "session/list", requestId: "list" });
	expect(controller.snapshot().sessions).toHaveLength(items.length);
	expect(controller.snapshot().sessionsError).toContain("取得できません");
	expect(controller.snapshot().sessionsLoading).toBe(false);
	expect(transport.listSessions).toHaveBeenCalledTimes(3);
});
