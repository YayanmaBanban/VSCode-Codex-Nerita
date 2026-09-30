// 追加指示の受付と、送信・停止・完了・切断の競合を検証する。
import { afterEach, expect, it, vi } from "vitest";
import { pending, piHarness } from "./piHarness";

const harnesses: ReturnType<typeof piHarness>[] = [];
afterEach(async () => {
	await Promise.all(harnesses.splice(0).map((h) => h.controller.dispose()));
});

/** 実行中の会話と、要求単位の受付・失敗を確認する補助を作る。 */
async function running() {
	const h = piHarness();
	harnesses.push(h);
	await h.controller.connect();
	await h.send("first", "first");
	return h;
}

it("拡張が開始入力を処理したら下書きを解放し、会話本文へ追加しない", async () => {
	const h = piHarness();
	harnesses.push(h);
	vi.mocked(h.runtime.prompt).mockImplementationOnce((_text, options) => {
		options?.preflightResult?.("handled");
		return Promise.resolve();
	});
	await h.controller.connect();
	await h.send("拡張入力", "handled-start");
	await vi.waitFor(() =>
		expect(h.controller.snapshot().run).toBe("completed"),
	);
	expect(h.controller.snapshot().messages).toEqual([]);
	expect(h.events).toContainEqual({
		type: "prompt/accepted",
		requestId: "handled-start",
		mode: "start",
	});
	expect(h.events.some((event) => event.type === "request/failed")).toBe(
		false,
	);
	await h.send("通常入力", "next");
	expect(
		h.controller.snapshot().messages.map((message) => message.text),
	).toEqual(["通常入力"]);
	h.complete();
});

it.each(["running", "complete", "stop", "disconnect"] as const)(
	"拡張が追加指示を処理した後の%sでも会話本文やキュー登録と混同しない",
	async (action) => {
		const h = await running();
		const gate = pending<Awaited<ReturnType<typeof h.runtime.steer>>>();
		vi.mocked(h.runtime.steer).mockReturnValueOnce(gate.promise);
		await h.send("拡張入力", "handled-steer");
		if (action === "complete") {
			h.complete();
		}
		if (action === "stop") {
			await h.stop();
		}
		if (action === "disconnect") {
			h.controller.invalidate();
		}
		await Promise.resolve();
		gate.resolve("handled");
		if (action === "running" || action === "complete") {
			await vi.waitFor(() =>
				expect(h.events).toContainEqual({
					type: "prompt/accepted",
					requestId: "handled-steer",
					mode: "steer",
				}),
			);
			expect(h.events).not.toContainEqual(
				expect.objectContaining({
					type: "request/failed",
					requestId: "handled-steer",
				}),
			);
		} else if (action === "stop") {
			await vi.waitFor(() =>
				expect(h.events).toContainEqual(
					expect.objectContaining({
						type: "request/failed",
						requestId: "handled-steer",
					}),
				),
			);
		} else {
			await h.controller.connect();
			expect(h.events).not.toContainEqual(
				expect.objectContaining({
					type: "prompt/accepted",
					requestId: "handled-steer",
				}),
			);
		}
		expect(
			h.controller
				.snapshot()
				.messages.some((message) => message.text === "拡張入力"),
		).toBe(false);
		if (action === "complete") {
			await vi.waitFor(() =>
				expect(h.controller.snapshot().run).toBe("completed"),
			);
			await h.send("通常入力", "next");
			expect(h.runtime.prompt).toHaveBeenCalledTimes(2);
		}
		h.complete();
	},
);

it("追加指示は同じrunへ入り、重複要求を再送しない", async () => {
	const h = await running();
	const runId = h.controller.snapshot().runId;
	await h.send("追加", "steer");
	await h.send("追加", "steer");
	await vi.waitFor(() =>
		expect(h.events).toContainEqual({
			type: "prompt/accepted",
			requestId: "steer",
			mode: "steer",
		}),
	);
	expect(h.runtime.steer).toHaveBeenCalledExactlyOnceWith("追加");
	expect(h.runtime.prompt).toHaveBeenCalledTimes(1);
	expect(h.controller.snapshot()).toMatchObject({ runId, run: "running" });
	expect(h.controller.snapshot().messages.map((m) => m.text)).toEqual([
		"first",
		"追加",
	]);
});

it("Steer受付中の連打を拒否し、受付後は次の追加指示を送れる", async () => {
	const h = await running();
	const gate = pending<Awaited<ReturnType<typeof h.runtime.steer>>>();
	vi.mocked(h.runtime.steer).mockReturnValueOnce(gate.promise);
	await h.send("追加", "a");
	await h.send("連打", "b");
	expect(h.runtime.steer).toHaveBeenCalledTimes(1);
	expect(h.events).toContainEqual(
		expect.objectContaining({ type: "request/failed", requestId: "b" }),
	);
	gate.resolve("queued");
	await vi.waitFor(() =>
		expect(h.events).toContainEqual({
			type: "prompt/accepted",
			requestId: "a",
			mode: "steer",
		}),
	);
	await h.send("次", "c");
	await vi.waitFor(() => expect(h.runtime.steer).toHaveBeenCalledTimes(2));
});

it.each(["stop", "complete", "disconnect"] as const)(
	"Steer処理中の%sでは遅れたキューを破棄する",
	async (action) => {
		const h = await running();
		const gate = pending<Awaited<ReturnType<typeof h.runtime.steer>>>();
		vi.mocked(h.runtime.steer).mockReturnValueOnce(gate.promise);
		await h.send("遅延", "late");
		if (action === "stop") {
			await h.stop();
		} else if (action === "complete") {
			h.complete();
		} else {
			h.controller.invalidate();
		}
		await Promise.resolve();
		if (action !== "disconnect") {
			await h.send("競合", "race");
			expect(h.runtime.prompt).toHaveBeenCalledTimes(1);
		}
		gate.resolve("queued");
		await vi.waitFor(() => expect(h.runtime.clearQueue).toHaveBeenCalled());
		if (action === "disconnect") {
			await h.controller.connect();
		} else {
			await vi.waitFor(() =>
				expect(h.controller.snapshot().run).toBe(
					action === "stop" ? "cancelled" : "completed",
				),
			);
		}
		expect(h.events).not.toContainEqual({
			type: "prompt/accepted",
			requestId: "late",
			mode: "steer",
		});
		expect(
			h.controller.snapshot().messages.some((m) => m.text === "遅延"),
		).toBe(false);
		await h.send("再送", "retry");
		expect(h.runtime.prompt).toHaveBeenCalledTimes(2);
	},
);

it("Stop直後の送信を拒否する", async () => {
	const h = await running();
	const abort = pending<void>();
	vi.mocked(h.runtime.abort).mockReturnValueOnce(abort.promise);
	await h.stop();
	await h.send("停止直後", "late");
	expect(h.runtime.steer).not.toHaveBeenCalled();
	expect(h.events).toContainEqual(
		expect.objectContaining({ type: "request/failed", requestId: "late" }),
	);
	abort.resolve();
	h.complete();
});

it("SDKが既に終了していれば新しいpromptへ暗黙に切り替えない", async () => {
	const h = await running();
	Object.defineProperty(h.runtime, "isStreaming", { value: false });
	await h.send("競合", "late");
	expect(h.runtime.steer).not.toHaveBeenCalled();
	expect(h.runtime.prompt).toHaveBeenCalledTimes(1);
	expect(h.events).toContainEqual(
		expect.objectContaining({ type: "request/failed", requestId: "late" }),
	);
});

it("Steer失敗は元の実行を壊さず、下書きを受付済みにしない", async () => {
	const h = await running();
	vi.mocked(h.runtime.steer).mockRejectedValueOnce(new Error("input failed"));
	await h.send("失敗", "failed");
	await vi.waitFor(() =>
		expect(h.events).toContainEqual({
			type: "request/failed",
			requestId: "failed",
			error: "input failed",
		}),
	);
	expect(h.controller.snapshot().run).toBe("running");
	expect(h.controller.snapshot().messages.map((m) => m.text)).toEqual([
		"first",
	]);
});

it("開始受付前の連打はSteerとして扱わない", async () => {
	const h = piHarness();
	harnesses.push(h);
	await h.controller.connect();
	const gate = pending<void>();
	vi.mocked(h.runtime.prompt).mockImplementationOnce(
		async (_text, options) => {
			await gate.promise;
			options?.preflightResult?.("started");
		},
	);
	await h.send("first");
	await h.send("連打", "early");
	expect(h.runtime.steer).not.toHaveBeenCalled();
	expect(h.events).toContainEqual(
		expect.objectContaining({ type: "request/failed", requestId: "early" }),
	);
	gate.resolve();
});
