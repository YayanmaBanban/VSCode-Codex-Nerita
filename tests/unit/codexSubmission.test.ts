// フォローアップの待機・受付・競合・失敗を実際のHost状態管理で確認する。
import { afterEach, expect, it, vi } from "vitest";
import { codexHarness, deferred } from "./codexHarness";
import type { HostMessage } from "../../src/shared/messages";
import { isHostMessage } from "../../src/shared/hostMessageValidation";
import { parseSteeredTurn } from "../../src/extension/codex/protocol/turn";

const harnesses: ReturnType<typeof codexHarness>[] = [];
afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(harnesses.splice(0).map((h) => h.session.dispose()));
});
/** 接続と最初の実行を準備し、受付結果を記録する。 */
async function running() {
	vi.useFakeTimers();
	const h = codexHarness();
	harnesses.push(h);
	const events: HostMessage[] = [];
	h.session.subscribe((event) => {
		expect(isHostMessage(event)).toBe(true);
		events.push(event);
	});
	await h.session.connect();
	await h.send();
	events.length = 0;
	return { ...h, events };
}
it("500ms後に同じターンへ送り、受付まで成功を通知しない", async () => {
	const h = await running();
	const runId = h.session.snapshot().runId;
	const response = deferred<{ turnId: string }>();
	h.client.steerTurn.mockReturnValueOnce(response.promise);
	const pending = h.send("追加の指示");
	await vi.advanceTimersByTimeAsync(499);
	expect(h.client.steerTurn).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(1);
	expect(h.client.steerTurn).toHaveBeenCalledWith(
		expect.objectContaining({
			threadId: "thread-1",
			expectedTurnId: "turn-1",
			input: [{ type: "text", text: "追加の指示", text_elements: [] }],
		}),
	);
	expect(h.events.some((e) => e.type === "prompt/accepted")).toBe(false);
	await h.send("二重送信");
	expect(h.client.steerTurn).toHaveBeenCalledTimes(1);
	response.resolve({ turnId: "turn-1" });
	await pending;
	expect(h.events).toContainEqual(
		expect.objectContaining({ type: "prompt/accepted", mode: "steer" }),
	);
	expect(h.session.snapshot().runId).toBe(runId);
	expect(h.session.snapshot().messages.map((m) => m.text)).toEqual([
		"hello",
		"追加の指示",
	]);
});
it("待機中に完了したら新しいターンへ一度だけ送る", async () => {
	const h = await running();
	const pending = h.send("続き");
	h.complete();
	await vi.advanceTimersByTimeAsync(500);
	await pending;
	expect(h.client.steerTurn).not.toHaveBeenCalled();
	expect(h.client.startTurn).toHaveBeenCalledTimes(2);
	expect(h.events).toContainEqual(
		expect.objectContaining({ type: "prompt/accepted", mode: "start" }),
	);
});
it("steer失敗は実行を終了せず、再試行できる", async () => {
	const h = await running();
	h.client.steerTurn.mockRejectedValueOnce(new Error("No active turn"));
	const pending = h.send("再送する指示");
	await vi.advanceTimersByTimeAsync(500);
	await pending;
	expect(h.events).toContainEqual(
		expect.objectContaining({ type: "request/failed" }),
	);
	expect(h.events.some((e) => e.type === "prompt/accepted")).toBe(false);
	expect(h.session.snapshot().run).toBe("running");
	expect(h.session.snapshot().messages).toHaveLength(1);
	expect(h.client.startTurn).toHaveBeenCalledTimes(1);
	const retry = h.send("再送する指示");
	await vi.advanceTimersByTimeAsync(500);
	await retry;
	expect(h.session.snapshot().messages).toHaveLength(2);
});
it("待機中の切断では古い接続へ送らない", async () => {
	const h = await running();
	const pending = h.send("古い会話");
	h.session.invalidate();
	await vi.advanceTimersByTimeAsync(500);
	await pending;
	expect(h.client.steerTurn).not.toHaveBeenCalled();
	expect(h.events).toContainEqual(
		expect.objectContaining({ type: "request/failed" }),
	);
});
it("通常送信の失敗も受付成功にせず、未送信メッセージを残さない", async () => {
	const h = await running();
	h.complete();
	h.client.startTurn.mockRejectedValueOnce(new Error("offline"));
	await h.send("未送信");
	expect(h.events.some((e) => e.type === "prompt/accepted")).toBe(false);
	expect(h.events).toContainEqual(
		expect.objectContaining({ type: "request/failed" }),
	);
	expect(h.session.snapshot().messages.map((m) => m.text)).toEqual(["hello"]);
});
it("steer受付のターンIDを検証する", () => {
	expect(parseSteeredTurn({ turnId: "t" })).toEqual({ turnId: "t" });
	for (const value of [null, {}, { turnId: "" }, { turnId: 1 }]) {
		expect(() => parseSteeredTurn(value)).toThrow();
	}
});

it("待機中に停止したターンを通常送信で再開しない", async () => {
	const h = await running();
	const pending = h.send("停止後には送らない");
	await h.cancel();
	h.complete("turn-1", "interrupted");
	await vi.advanceTimersByTimeAsync(500);
	await pending;
	expect(h.client.startTurn).toHaveBeenCalledTimes(1);
	expect(h.client.steerTurn).not.toHaveBeenCalled();
	expect(h.session.snapshot().run).toBe("cancelled");
	expect(h.events).toContainEqual(
		expect.objectContaining({ type: "request/failed" }),
	);
});

it("フォローアップ受付より先に完了しても受付成功を返す", async () => {
	const h = await running();
	const response = deferred<{ turnId: string }>();
	h.client.steerTurn.mockReturnValueOnce(response.promise);
	const pending = h.send("受付済みの指示");
	await vi.advanceTimersByTimeAsync(500);
	h.complete();
	response.resolve({ turnId: "turn-1" });
	await pending;
	expect(h.events).toContainEqual(
		expect.objectContaining({ type: "prompt/accepted", mode: "steer" }),
	);
	expect(h.session.snapshot().run).toBe("completed");
	expect(h.session.snapshot().messages.at(-1)?.text).toBe("受付済みの指示");
});
