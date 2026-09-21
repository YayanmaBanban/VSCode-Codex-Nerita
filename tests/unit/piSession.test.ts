// Piの複数ターン・停止競合・旧接続通知を通信契約ごと検証する。
import { afterEach, expect, it, vi } from "vitest";
import { isHostMessage } from "../../src/shared/hostMessageValidation";
import type { PiSessionController } from "../../src/extension/backends/pi/PiSessionController";
import { assistant, pending, piHarness } from "./piHarness";

const controllers: PiSessionController[] = [];
afterEach(async () => {
	await Promise.all(
		controllers.splice(0).map((controller) => controller.dispose()),
	);
});

/** 接続後の通知を既存Webviewのvalidatorにも通す。 */
async function connected() {
	const harness = piHarness();
	controllers.push(harness.controller);
	harness.controller.subscribe((event) =>
		expect(isHostMessage(event)).toBe(true),
	);
	await harness.controller.connect();
	return harness;
}

it("受付を通知し、複数Assistantの本文を確定してSDK送信の終了を待つ", async () => {
	const h = await connected();
	await h.send();
	expect(h.events).toContainEqual({
		type: "prompt/accepted",
		requestId: "send-1",
		mode: "start",
	});
	h.emit({ type: "message_start", message: assistant("") });
	h.emit({
		type: "message_update",
		message: assistant("こん"),
		assistantMessageEvent: {
			type: "text_delta",
			contentIndex: 0,
			delta: "こん",
			partial: assistant("こん"),
		},
	});
	expect(h.controller.snapshot().messages.at(-1)).toMatchObject({
		text: "こん",
		streaming: true,
	});
	h.emit({ type: "message_end", message: assistant("こんにちは") });
	h.emit({
		type: "turn_end",
		message: assistant("こんにちは"),
		toolResults: [],
	});
	expect(h.controller.snapshot().run).toBe("running");
	h.emit({ type: "message_start", message: assistant("次の回答") });
	h.emit({ type: "message_end", message: assistant("次の回答") });
	h.complete();
	await vi.waitFor(() =>
		expect(h.controller.snapshot().run).toBe("completed"),
	);
	expect(h.controller.snapshot().messages.map((m) => m.text)).toEqual([
		"hello",
		"こんにちは",
		"次の回答",
	]);
});

it("重複送信・古いStopを拒否し、追加指示・停止後の再送ができる", async () => {
	const h = await connected();
	await h.send("first", "once");
	await h.send("first", "once");
	await h.send("busy");
	expect(h.runtime.prompt).toHaveBeenCalledTimes(1);
	expect(h.runtime.steer).toHaveBeenCalledExactlyOnceWith("busy");
	await h.controller.receive({
		type: "prompt/cancel",
		requestId: "stale",
		sessionId: "pi-1",
		runId: "old",
	});
	expect(h.runtime.abort).not.toHaveBeenCalled();
	await h.stop();
	await vi.waitFor(() =>
		expect(h.controller.snapshot().run).toBe("cancelled"),
	);
	await h.send("second");
	expect(h.runtime.prompt).toHaveBeenCalledTimes(2);
	h.complete();
});

it("preflight前のStopは受付せず下書きを残す", async () => {
	const h = await connected();
	const preflight = pending<void>();
	vi.mocked(h.runtime.prompt).mockImplementationOnce(
		async (_text, options) => {
			await preflight.promise;
			options?.preflightResult?.(true);
		},
	);
	await h.send();
	await h.stop();
	preflight.resolve();
	await vi.waitFor(() =>
		expect(h.controller.snapshot().run).toBe("cancelled"),
	);
	expect(h.controller.snapshot().messages).toEqual([]);
	expect(h.events.some((event) => event.type === "prompt/accepted")).toBe(
		false,
	);
	expect(h.events.some((event) => event.type === "request/failed")).toBe(
		true,
	);
});

it("認証失敗とモデルのエラー応答を成功扱いにしない", async () => {
	const h = await connected();
	vi.mocked(h.runtime.prompt).mockRejectedValueOnce(
		new Error("APIキーを設定してください"),
	);
	await h.send();
	await vi.waitFor(() => expect(h.controller.snapshot().run).toBe("failed"));
	expect(h.controller.snapshot().messages).toEqual([]);
	await h.send();
	h.emit({
		type: "message_end",
		message: { ...assistant("", "error"), errorMessage: "rate limit" },
	});
	h.complete();
	await vi.waitFor(() =>
		expect(h.controller.snapshot().error).toBe("rate limit"),
	);
	expect(h.controller.snapshot().run).toBe("failed");
});

it("起動中に破棄されたSDKも回収しreadyに戻らない", async () => {
	const h = piHarness();
	const opening = pending<Awaited<ReturnType<typeof h.factory>>>();
	h.factory.mockReturnValueOnce(opening.promise);
	const connecting = h.controller.connect();
	await vi.waitFor(() => expect(h.factory).toHaveBeenCalled());
	const disposing = h.controller.dispose();
	opening.resolve({ session: h.runtime, cwd: "old" });
	await Promise.all([connecting, disposing]);
	expect(h.runtime.dispose).toHaveBeenCalledOnce();
	expect(h.controller.snapshot().connection).not.toBe("ready");
});

it("無効化後の送信結果とイベントを捨て、新規会話は初期化する", async () => {
	const h = await connected();
	await h.send();
	h.controller.invalidate();
	h.emit({ type: "message_end", message: assistant("old") });
	await h.controller.connect();
	expect(h.controller.snapshot().messages).toEqual([]);
	await h.send();
	h.complete();
	await vi.waitFor(() =>
		expect(h.controller.snapshot().run).toBe("completed"),
	);
	await h.controller.receive({ type: "session/new", requestId: "new" });
	expect(h.controller.snapshot().messages).toEqual([]);
	expect(h.controller.snapshot().attachmentsSupported).toBe(false);
	expect(h.controller.snapshot().sessionCapabilities.list).toBe(false);
});
