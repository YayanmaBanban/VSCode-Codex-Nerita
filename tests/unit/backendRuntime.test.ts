// 接続の切替・遅延通知・差分の基準番号・再接続後の送信を検証する。
import { expect, it, vi } from "vitest";
import { initialState } from "../../src/shared/chatState";
import type { HostMessage } from "../../src/shared/messages";
import { applyStatePatch } from "../../src/shared/toolUpdates";
import { BackendRuntime } from "../../src/extension/session/BackendRuntime";
import { codexHarness, deferred } from "./codexHarness";

/** 解除後に遅れて届く通知も再現できる接続を作る。 */
function backend() {
	let listener: ((event: HostMessage) => void) | undefined;
	return {
		snapshot: () => initialState(),
		subscribe: (next: (event: HostMessage) => void) => {
			listener = next;
			return vi.fn();
		},
		receive: vi.fn().mockResolvedValue(undefined),
		invalidate: vi.fn(),
		dispose: vi.fn().mockResolvedValue(undefined),
		emit: (event: HostMessage) => listener?.(event),
	};
}

it("旧接続の終了を待ち、購読を保持して古い通知を破棄する", async () => {
	const old = backend(),
		next = backend(),
		ending = deferred<void>();
	old.dispose.mockReturnValue(ending.promise);
	const factory = vi.fn().mockReturnValueOnce(old).mockReturnValue(next);
	const runtime = new BackendRuntime(factory);
	const sidebar = vi.fn(),
		panel = vi.fn();
	runtime.subscribe(sidebar);
	runtime.subscribe(panel);
	const switching = runtime.restart();
	expect(runtime.restart()).toBe(switching);
	expect(factory).toHaveBeenCalledOnce();
	const count = sidebar.mock.calls.length;
	old.emit({
		type: "state/patch",
		revision: 10,
		patch: { sessionTitle: "old" },
	});
	expect(sidebar).toHaveBeenCalledTimes(count);
	ending.resolve();
	await switching;
	expect(next.receive).toHaveBeenCalledWith(
		expect.objectContaining({ type: "connection/retry" }),
	);
	await runtime.receive({ type: "session/new", requestId: "new" });
	expect(next.receive).toHaveBeenLastCalledWith({
		type: "session/new",
		requestId: "new",
	});
	expect(sidebar.mock.calls).toEqual(panel.mock.calls);
	runtime.invalidate();
	expect(next.invalidate).toHaveBeenCalledOnce();
	await runtime.dispose();
	expect(next.dispose).toHaveBeenCalledOnce();
});

it("集約差分の基準番号も表示先の更新番号へ変換する", async () => {
	const source = backend(),
		runtime = new BackendRuntime(() => source);
	const listener = vi.fn();
	runtime.subscribe(listener);
	source.emit({
		type: "state/snapshot",
		state: { ...initialState(), revision: 40 },
	});
	source.emit({
		type: "state/patch",
		baseRevision: 40,
		revision: 47,
		patch: { sessionTitle: "new" },
	});
	expect(listener).toHaveBeenLastCalledWith({
		type: "state/patch",
		baseRevision: 1,
		revision: 2,
		patch: { sessionTitle: "new" },
	});
	await runtime.dispose();
});

it("切替後の再接続でも差分を再取得せず新しい会話へ送信できる", async () => {
	const harnesses = [codexHarness(), codexHarness()];
	let index = 0;
	const runtime = new BackendRuntime(() => harnesses[index++]!.session);
	let displayed = runtime.snapshot();
	const gaps: number[] = [];
	runtime.subscribe((event) => {
		if (event.type === "state/snapshot") {
			displayed = event.state;
		}
		if (event.type === "state/patch") {
			if (
				(event.baseRevision ?? event.revision - 1) !==
				displayed.revision
			) {
				gaps.push(event.revision);
				return;
			}
			displayed = applyStatePatch(displayed, event);
		}
	});
	try {
		await runtime.restart();
		const oldId = displayed.sessionId;
		await runtime.receive({
			type: "connection/retry",
			requestId: "reconnect",
		});
		expect(gaps).toEqual([]);
		expect(displayed.sessionId).not.toBe(oldId);
		expect(displayed.sessionId).toBe(runtime.snapshot().sessionId);
		await runtime.receive({
			type: "prompt/send",
			requestId: "send",
			sessionId: displayed.sessionId!,
			text: "hello",
		});
		expect(harnesses[1]!.client.startTurn).toHaveBeenCalledWith(
			expect.objectContaining({ threadId: displayed.sessionId }),
		);
	} finally {
		await runtime.dispose();
	}
});

it("切替中に終了した場合は次の接続を生成しない", async () => {
	const source = backend(),
		ending = deferred<void>();
	source.dispose.mockReturnValue(ending.promise);
	const factory = vi.fn(() => source),
		runtime = new BackendRuntime(factory);
	const switching = runtime.restart(),
		closing = runtime.dispose();
	ending.resolve();
	await Promise.all([switching, closing]);
	expect(factory).toHaveBeenCalledOnce();
	expect(source.dispose).toHaveBeenCalledOnce();
});

it("生成失敗を通知し、再接続で復旧する", async () => {
	const source = backend(),
		next = backend();
	const factory = vi
		.fn()
		.mockReturnValueOnce(source)
		.mockImplementationOnce(() => {
			throw new Error("failed");
		})
		.mockReturnValue(next);
	const runtime = new BackendRuntime(factory);
	await runtime.restart();
	expect(runtime.snapshot().connection).toBe("error");
	await runtime.receive({ type: "connection/retry", requestId: "retry" });
	expect(next.receive).toHaveBeenCalledWith(
		expect.objectContaining({ type: "connection/retry" }),
	);
	await runtime.dispose();
});
