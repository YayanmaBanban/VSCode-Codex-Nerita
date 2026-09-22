// 本文取得を含む通常送信・追加指示・停止時の境界を両バックエンドで確認する。
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../src/extension/session/codeReferenceContext", () => ({
	readCodeReferenceContext: api.read,
	CodeReferenceError: class extends Error {
		constructor() {
			super("コードを追加し直してください");
		}
	},
}));
import { codexHarness, deferred } from "./codexHarness";
import { piHarness } from "./piHarness";
import type { HostMessage } from "../../src/shared/messages";
import { CodeReferenceError } from "../../src/extension/session/codeReferenceContext";

const dispose: (() => Promise<void>)[] = [];
const codeReferences = [
	{
		uri: "file:///D:/test.ts",
		range: {
			start: { line: 1, character: 0 },
			end: { line: 2, character: 3 },
		},
	},
];
beforeEach(() => {
	api.read.mockReset().mockResolvedValue("latest unsaved code");
});
afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(dispose.splice(0).map((fn) => fn()));
});

it("Codexの通常送信と追加指示に最新コードを資料として渡す", async () => {
	vi.useFakeTimers();
	const h = codexHarness();
	dispose.push(() => h.session.dispose());
	await h.session.connect();
	const send = (id: string) =>
		h.session.receive({
			type: "prompt/send",
			requestId: id,
			sessionId: "thread-1",
			text: "review",
			codeReferences,
		});
	await send("first");
	expect(api.read).toHaveBeenCalledWith(codeReferences, expect.any(Function));
	expect(h.client.startTurn).toHaveBeenCalledWith(
		expect.objectContaining({
			additionalContext: {
				code_references: {
					value: "latest unsaved code",
					kind: "untrusted",
				},
			},
		}),
	);
	api.read.mockResolvedValue("edited again");
	const pending = send("second");
	await vi.advanceTimersByTimeAsync(500);
	await pending;
	expect(h.client.steerTurn).toHaveBeenCalledWith(
		expect.objectContaining({
			additionalContext: {
				code_references: { value: "edited again", kind: "untrusted" },
			},
		}),
	);
	expect(
		h.session.snapshot().messages.map((message) => message.text),
	).toEqual(["review", "review"]);
});

it("Codexは参照読み込み失敗で送信を受け付けず、再試行できる", async () => {
	const h = codexHarness();
	dispose.push(() => h.session.dispose());
	await h.session.connect();
	const events: HostMessage[] = [];
	h.session.subscribe((event) => events.push(event));
	api.read.mockRejectedValueOnce(new CodeReferenceError());
	await h.session.receive({
		type: "prompt/send",
		requestId: "failed",
		sessionId: "thread-1",
		text: "review",
		codeReferences,
	});
	expect(h.client.startTurn).not.toHaveBeenCalled();
	expect(events).toContainEqual({
		type: "request/failed",
		requestId: "failed",
		error: "コードを追加し直してください",
	});
	await h.send("retry");
	expect(h.client.startTurn).toHaveBeenCalledTimes(1);
});

it("Piの通常送信と追加指示へコードを添え、表示本文を維持する", async () => {
	const h = piHarness();
	dispose.push(() => h.controller.dispose());
	await h.controller.connect();
	const send = (id: string) =>
		h.controller.receive({
			type: "prompt/send",
			requestId: id,
			sessionId: "pi-1",
			text: "review",
			codeReferences,
		});
	await send("first");
	await vi.waitFor(() =>
		expect(h.runtime.prompt).toHaveBeenCalledWith(
			"review\n\nlatest unsaved code",
			expect.anything(),
		),
	);
	api.read.mockResolvedValue("edited again");
	await send("second");
	await vi.waitFor(() =>
		expect(h.runtime.steer).toHaveBeenCalledWith("review\n\nedited again"),
	);
	expect(
		h.controller.snapshot().messages.map((message) => message.text),
	).toEqual(["review", "review"]);
	h.complete();
});

it("Piは読み込み中に停止したコードを送らない", async () => {
	const h = piHarness();
	dispose.push(() => h.controller.dispose());
	await h.controller.connect();
	const reading = deferred<string>();
	api.read.mockReturnValue(reading.promise);
	await h.controller.receive({
		type: "prompt/send",
		requestId: "first",
		sessionId: "pi-1",
		text: "review",
		codeReferences,
	});
	await h.stop();
	reading.resolve("late code");
	await vi.waitFor(() =>
		expect(h.controller.snapshot().run).toBe("cancelled"),
	);
	expect(h.runtime.prompt).not.toHaveBeenCalled();
	expect(h.events.some((event) => event.type === "prompt/accepted")).toBe(
		false,
	);
});
