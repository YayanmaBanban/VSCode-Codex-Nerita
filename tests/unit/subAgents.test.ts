// 活動の完了とAgentの完了、通知順序、閲覧の副作用を回帰検証する。
import { afterEach, expect, it, vi } from "vitest";
vi.mock("vscode", () => ({ workspace: {}, window: {} }));
import { initialState } from "../../src/shared/chatState";
import { type HostMessage } from "../../src/shared/messages";
import { isHostMessage } from "../../src/shared/hostMessageValidation";
import { isUiMessage } from "../../src/shared/uiMessageValidation";
import { itemPatch } from "../../src/extension/codex/items/chatItems";
import { AgentRegistry } from "../../src/extension/codex/agents/AgentRegistry";
import { codexHarness, deferred, historyThread } from "./codexHarness";

const started = {
	id: "activity",
	type: "subAgentActivity",
	kind: "started",
	agentThreadId: "child",
	agentPath: "/root/reviewer",
};
const harnesses: ReturnType<typeof codexHarness>[] = [];
afterEach(async () => {
	await Promise.all(harnesses.splice(0).map((h) => h.session.dispose()));
});
/** Agent開始通知を実際のコントローラーへ送る。 */
async function connected() {
	const h = codexHarness();
	harnesses.push(h);
	await h.session.connect();
	await h.send();
	h.notify("item/completed", {
		threadId: "thread-1",
		turnId: "turn-1",
		item: started,
	});
	await Promise.resolve();
	return h;
}

it("最終一覧だけで届いたAgentも本文の間に配置し、新規会話へ持ち越さない", async () => {
	const h = codexHarness();
	harnesses.push(h);
	await h.session.connect();
	await h.send();
	h.notify("turn/completed", {
		threadId: "thread-1",
		turn: {
			id: "turn-1",
			status: "completed",
			items: [
				{ id: "before", type: "agentMessage", text: "依頼します" },
				started,
				{ id: "after", type: "agentMessage", text: "依頼しました" },
			],
		},
	});
	const state = h.session.snapshot();
	expect(state.messages[1]!.order).toBeLessThan(state.agents[0]!.order);
	expect(state.agents[0]!.order).toBeLessThan(state.messages[2]!.order!);
	expect(state.agents[0]!.status).toBe("running");
	await h.session.receive({ type: "session/new", requestId: "new" });
	expect(h.session.snapshot().agents).toEqual([]);
});

it("started項目が完了してもAgentは実行中で、同じThreadのカードは増えない", () => {
	const state = { ...initialState(), sessionId: "root", runId: "run" };
	Object.assign(state, itemPatch(state, started, true));
	Object.assign(state, itemPatch(state, started, true));
	expect(state.tools).toEqual([]);
	expect(state.agents).toHaveLength(1);
	expect(state.agents[0]).toMatchObject({
		threadId: "child",
		status: "running",
		parentThreadId: "root",
	});
	const order = state.agents[0]!.order;
	Object.assign(
		state,
		itemPatch(state, { ...started, id: "end", kind: "completed" }, true),
	);
	expect(state.agents[0]).toMatchObject({ status: "completed", order });
});

it("開始応答前の本文とAgent通知も受信順を保つ", async () => {
	const h = codexHarness();
	harnesses.push(h);
	await h.session.connect();
	const response = deferred<Awaited<ReturnType<typeof h.client.startTurn>>>();
	h.client.startTurn.mockReturnValueOnce(response.promise);
	const sending = h.send();
	await Promise.resolve();
	h.notify("item/completed", {
		threadId: "thread-1",
		turnId: "early",
		item: { id: "before", type: "agentMessage", text: "依頼します" },
	});
	h.notify("item/completed", {
		threadId: "thread-1",
		turnId: "early",
		item: started,
	});
	expect(h.session.snapshot().agents).toEqual([]);
	response.resolve({ turn: { id: "early", status: "inProgress" } });
	await sending;
	const state = h.session.snapshot();
	expect(state.messages[1]!.order).toBeLessThan(state.agents[0]!.order);
});

it("協調ツール単独では生成せず、既存Agentにモデルと状態を補完する", () => {
	const state = initialState();
	const collab = {
		id: "collab",
		type: "collabAgentToolCall",
		tool: "spawnAgent",
		receiverThreadIds: ["child"],
		model: "test-model",
		reasoningEffort: "high",
		agentsStates: { child: { status: "running" } },
	};
	Object.assign(state, itemPatch(state, collab, true));
	expect(state.agents).toEqual([]);
	expect(state.tools).toEqual([]);
	Object.assign(state, itemPatch(state, started, true));
	Object.assign(state, itemPatch(state, collab, true));
	expect(state.agents[0]).toMatchObject({
		model: "test-model",
		reasoningEffort: "high",
		lastAction: "spawnAgent",
	});
});

it("先着Thread状態を優先し、idleは完了を消さず、最終一覧の再送で巻き戻らない", () => {
	const registry = new AgentRegistry();
	const state = { ...initialState(), sessionId: "root" };
	const notify = (method: string, params: unknown) =>
		Object.assign(state, registry.notification(state, { method, params }));
	notify("thread/status/changed", {
		threadId: "child",
		status: { type: "idle" },
	});
	notify("item/completed", {
		threadId: "root",
		turnId: "turn",
		item: started,
	});
	expect(state.agents[0]?.status).toBe("idle");
	notify("item/completed", {
		threadId: "root",
		turnId: "turn",
		item: {
			id: "collab",
			type: "collabAgentToolCall",
			receiverThreadIds: ["child"],
			agentsStates: { child: { status: "running" } },
		},
	});
	expect(state.agents[0]?.status).toBe("idle");
	notify("item/completed", {
		threadId: "root",
		turnId: "turn",
		item: { ...started, id: "end", kind: "completed" },
	});
	notify("thread/status/changed", {
		threadId: "child",
		status: { type: "idle" },
	});
	notify("turn/completed", {
		threadId: "root",
		turn: { id: "turn", items: [started] },
	});
	expect(state.agents[0]?.status).toBe("completed");
	notify("item/completed", {
		threadId: "root",
		turnId: "next",
		item: { ...started, id: "again", kind: "interacted" },
	});
	expect(state.agents[0]?.status).toBe("running");
});

it("親の完了後も子Threadの状態を受信し、遅いメタデータ応答は状態を戻さない", async () => {
	const h = codexHarness();
	harnesses.push(h);
	const response =
		deferred<Awaited<ReturnType<typeof h.client.readThread>>>();
	h.client.readThread.mockReturnValueOnce(response.promise);
	await h.session.connect();
	await h.send();
	h.notify("item/completed", {
		threadId: "thread-1",
		turnId: "turn-1",
		item: started,
	});
	h.complete();
	h.notify("thread/status/changed", {
		threadId: "child",
		status: { type: "systemError" },
	});
	response.resolve({
		thread: {
			...historyThread("child"),
			agentNickname: "swift-cheetah",
			agentRole: "reviewer",
			status: "idle",
		},
	});
	await response.promise;
	await Promise.resolve();
	expect(h.session.snapshot().agents[0]).toMatchObject({
		nickname: "swift-cheetah",
		role: "reviewer",
		status: "systemError",
	});
});

it("実行中の子をページ取得しても親の会話と実行を保持し、resumeしない", async () => {
	const h = await connected();
	const before = h.session.snapshot();
	const events: HostMessage[] = [];
	h.session.subscribe((event) => {
		expect(isHostMessage(event)).toBe(true);
		events.push(event);
	});
	h.client.readThread.mockResolvedValue({
		thread: {
			...historyThread("child"),
			parentThreadId: "thread-1",
			historyMode: "paginated",
			active: true,
		},
	});
	h.client.listTurns.mockResolvedValue({
		data: [
			{
				id: "child-turn",
				status: "inProgress",
				itemsView: "summary",
				items: [],
			},
		],
		nextCursor: null,
	});
	h.client.listItems.mockResolvedValue({
		data: [
			{
				turnId: "child-turn",
				item: {
					id: "question",
					type: "userMessage",
					content: [{ type: "text", text: "調査してください" }],
				},
			},
			{
				turnId: "child-turn",
				item: {
					...started,
					id: "grand-start",
					agentThreadId: "grandchild",
					agentPath: "/root/reviewer/helper",
				},
			},
		],
		nextCursor: null,
	});
	await h.session.receive({
		type: "agent/read",
		requestId: "read",
		sessionId: "thread-1",
		threadId: "child",
	});
	expect(h.client.readThread).toHaveBeenCalledWith("child", true);
	expect(h.client.listItems).toHaveBeenCalledWith(
		"child",
		"child-turn",
		undefined,
	);
	expect(h.client.resumeThread).not.toHaveBeenCalled();
	expect(h.session.snapshot()).toMatchObject({
		sessionId: before.sessionId,
		runId: before.runId,
		run: before.run,
		messages: before.messages,
	});
	expect(events.find((event) => event.type === "agent/view")).toMatchObject({
		view: {
			threadId: "child",
			messages: [{ text: "調査してください" }],
			agents: [{ threadId: "grandchild", parentThreadId: "child" }],
		},
	});
});

it("未知のThread閲覧と会話切替後の遅い応答を拒否する", async () => {
	const h = await connected();
	const events: HostMessage[] = [];
	h.session.subscribe((event) => events.push(event));
	h.client.readThread.mockClear();
	await h.session.receive({
		type: "agent/read",
		requestId: "unknown",
		sessionId: "thread-1",
		threadId: "unknown",
	});
	expect(h.client.readThread).not.toHaveBeenCalled();
	const response =
		deferred<Awaited<ReturnType<typeof h.client.readThread>>>();
	h.client.readThread.mockReturnValueOnce(response.promise);
	const reading = h.session.receive({
		type: "agent/read",
		requestId: "late",
		sessionId: "thread-1",
		threadId: "child",
	});
	h.session.invalidate();
	response.resolve({ thread: historyThread("child") });
	await reading;
	expect(events.some((event) => event.type === "agent/view")).toBe(false);
	expect(
		isUiMessage({
			type: "agent/read",
			requestId: "x",
			sessionId: "root",
			threadId: "",
		}),
	).toBe(false);
});
