// 生成待ち・停止・失敗が親セッションへ誤送信しないことを確認する。
import { afterEach, expect, it, vi } from "vitest";
import { codexHarness, historyThread } from "./codexHarness";
import { piHarness } from "./piHarness";
const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("../../src/extension/backends/codex/context/handoffGeneration", () => ({
	generateCodexHandoff: mocks.generate,
}));
vi.mock("../../src/extension/agentManager/WorkspaceFiles", () => ({
	readWorkspaceFile: () => Promise.resolve(undefined),
}));
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((close) => close()));
	vi.clearAllMocks();
});

/** 参照元を復元せず読める Codex の接続を作る。 */
async function codex() {
	const h = codexHarness();
	cleanups.push(() => h.session.dispose());
	await h.session.connect();
	h.client.readThread.mockImplementation((id) =>
		Promise.resolve({
			thread: {
				...historyThread(id),
				turns: [
					{
						id: "saved-turn",
						status: "completed",
						itemsView: "full",
						items: [
							{
								id: "reply",
								type: "agentMessage",
								text: "source",
							},
						],
					},
				],
			},
		}),
	);
	return h;
}
it("Codex は現在セッションに要約を注入し参照元を再開しない", async () => {
	const h = await codex();
	mocks.generate.mockResolvedValue("summary");
	await h.session.receive({
		type: "prompt/send",
		requestId: "handoff",
		sessionId: h.session.snapshot().sessionId,
		text: "next",
		sessionReferences: [{ sessionId: "saved", mode: "handoff" }],
	});
	expect(h.client.startTurn.mock.calls[0]![0]).toMatchObject({
		threadId: "thread-1",
		additionalContext: {
			"referenced_handoff:saved": { kind: "untrusted", value: "summary" },
		},
	});
	expect(h.client.resumeThread).not.toHaveBeenCalled();
	expect(h.client.startThread).toHaveBeenCalledTimes(1);
	expect(h.session.snapshot().sessionId).toBe("thread-1");
});
it("Codex の生成待ちを停止すると親ターンを開始しない", async () => {
	const h = await codex();
	mocks.generate.mockImplementation(() => new Promise(() => {}));
	const send = h.session.receive({
		type: "prompt/send",
		requestId: "handoff",
		sessionId: h.session.snapshot().sessionId,
		text: "next",
		sessionReferences: [{ sessionId: "saved", mode: "handoff" }],
	});
	await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalled());
	await h.session.receive({
		type: "prompt/cancel",
		requestId: "stop",
		sessionId: h.session.snapshot().sessionId,
		runId: h.session.snapshot().runId,
	});
	await send;
	expect(h.client.startTurn).not.toHaveBeenCalled();
	expect(h.session.snapshot().run).toBe("idle");
});
it("Codex の生成失敗で要約エラーを通知し親ターンを開始しない", async () => {
	const h = await codex();
	mocks.generate.mockRejectedValue(new Error("provider"));
	const events: unknown[] = [];
	h.session.subscribe((event) => events.push(event));
	await h.session.receive({
		type: "prompt/send",
		requestId: "handoff",
		sessionId: h.session.snapshot().sessionId,
		text: "next",
		sessionReferences: [{ sessionId: "saved", mode: "handoff" }],
	});
	expect(h.client.startTurn).not.toHaveBeenCalled();
	expect(events).toContainEqual(
		expect.objectContaining({
			type: "request/failed",
			error: expect.stringContaining("ハンドオフ") as unknown,
		}),
	);
});

/** Pi の履歴読込と生成だけを SDK 境界で差し替える。 */
async function pi() {
	const h = piHarness();
	cleanups.push(() => h.controller.dispose());
	Object.defineProperty(h.runtime, "model", {
		value: { provider: "test", id: "model" },
	});
	h.runtime.history = {
		entries: [],
		list: () => Promise.resolve([]),
		target: (id) => ({ id, directory: "sessions", storage: "workspace" }),
		readContext: vi.fn(() => Promise.resolve("source")),
	};
	h.runtime.generateHandoff = vi.fn(() => Promise.resolve("summary"));
	await h.controller.connect();
	return h;
}
it("Pi は原文と要約を現在セッションへ渡し、再接続しない", async () => {
	const h = await pi();
	await h.controller.receive({
		type: "prompt/send",
		requestId: "handoff",
		sessionId: "pi-1",
		text: "next",
		sessionReferences: [
			{ sessionId: "saved", mode: "transcript" },
			{ sessionId: "saved", mode: "handoff" },
		],
	});
	await vi.waitFor(() => expect(h.runtime.prompt).toHaveBeenCalled());
	const prompt = vi.mocked(h.runtime.prompt).mock.calls[0]![0];
	expect(prompt).toContain(
		'"referenced_session:saved":{"kind":"untrusted","value":"source"}',
	);
	expect(prompt).toContain(
		'"referenced_handoff:saved":{"kind":"untrusted","value":"summary"}',
	);
	expect(h.factory).toHaveBeenCalledTimes(1);
	expect(h.controller.snapshot().sessionId).toBe("pi-1");
	h.complete();
});
it("Pi の生成待ちを停止しても親へ送信しない", async () => {
	const h = await pi();
	vi.mocked(h.runtime.generateHandoff!).mockImplementation(
		() => new Promise(() => {}),
	);
	await h.controller.receive({
		type: "prompt/send",
		requestId: "handoff",
		sessionId: "pi-1",
		text: "next",
		sessionReferences: [{ sessionId: "saved", mode: "handoff" }],
	});
	await vi.waitFor(() =>
		expect(h.runtime.generateHandoff).toHaveBeenCalled(),
	);
	await h.stop();
	await vi.waitFor(() =>
		expect(h.controller.snapshot().run).toBe("cancelled"),
	);
	expect(h.runtime.prompt).not.toHaveBeenCalled();
});
