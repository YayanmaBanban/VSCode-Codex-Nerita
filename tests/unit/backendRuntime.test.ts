// バックエンド切替の終了順序・購読継続・更新番号・終了競合を検証する。
import { expect, it, vi } from "vitest";
import { initialState } from "../../src/shared/chatState";
import type { HostMessage } from "../../src/shared/messages";
import { BackendRuntime } from "../../src/extension/session/BackendRuntime";
import { codexHarness } from "./codexHarness";
import { applyStatePatch } from "../../src/shared/toolUpdates";

/** 解除後の遅延通知も再現できるバックエンドを作る。 */
function backend() {
	let listener: ((event: HostMessage) => void) | undefined;
	return {
		snapshot: () => initialState(),
		subscribe: vi.fn((next: (event: HostMessage) => void) => {
			listener = next;
			return vi.fn();
		}),
		receive: vi.fn().mockResolvedValue(undefined),
		invalidate: vi.fn(),
		dispose: vi.fn().mockResolvedValue(undefined),
		emit: (event: HostMessage) => listener?.(event),
	};
}

it("集約された差分の基準番号もUIの更新番号へ変換する", async () => {
	const source = backend();
	const runtime = new BackendRuntime(() => source);
	const listener = vi.fn<(event: HostMessage) => void>();
	runtime.subscribe(listener);
	source.emit({
		type: "state/snapshot",
		state: { ...initialState(), revision: 40 },
	});
	source.emit({
		type: "state/patch",
		baseRevision: 40,
		revision: 47,
		patch: { sessionTitle: "updated" },
	});
	expect(listener).toHaveBeenLastCalledWith({
		type: "state/patch",
		baseRevision: 1,
		revision: 2,
		patch: { sessionTitle: "updated" },
	});
	await runtime.dispose();
});

it("バックエンド再生成後の再接続でも差分だけで新しい会話へ送信できる", async () => {
	const harnesses = [codexHarness(), codexHarness()];
	let index = 0;
	const runtime = new BackendRuntime(() => harnesses[index++]!.session);
	let displayed = runtime.snapshot();
	const gaps: HostMessage[] = [];
	runtime.subscribe((event) => {
		if (event.type === "state/snapshot") {
			displayed = event.state;
		}
		if (event.type === "state/patch") {
			if (
				(event.baseRevision ?? event.revision - 1) !==
				displayed.revision
			) {
				gaps.push(event);
				return;
			}
			displayed = applyStatePatch(displayed, event);
		}
	});
	try {
		await runtime.restart();
		const previousId = displayed.sessionId;
		await runtime.receive({
			type: "connection/retry",
			requestId: "sandbox-reconnect",
		});
		expect(gaps).toEqual([]);
		expect(displayed.sessionId).not.toBe(previousId);
		expect(displayed.sessionId).toBe(runtime.snapshot().sessionId);
		await runtime.receive({
			type: "prompt/send",
			requestId: "after-reconnect",
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

it("終了を待って切り替え、両表示先の購読と単調増加する更新番号を維持する", async () => {
	const old = backend(),
		next = backend();
	let finish!: () => void;
	old.dispose.mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	const factory = vi.fn().mockReturnValueOnce(old).mockReturnValue(next);
	const runtime = new BackendRuntime(factory);
	const sidebar = vi.fn<(event: HostMessage) => void>(),
		panel = vi.fn<(event: HostMessage) => void>();
	runtime.subscribe(sidebar);
	runtime.subscribe(panel);
	old.emit({
		type: "state/patch",
		revision: 100,
		patch: { sessionTitle: "old" },
	});
	const switching = runtime.restart();
	expect(runtime.restart()).toBe(switching);
	expect(factory).toHaveBeenCalledTimes(1);
	const count = sidebar.mock.calls.length;
	old.emit({
		type: "state/patch",
		revision: 101,
		patch: { sessionTitle: "stale" },
	});
	expect(sidebar).toHaveBeenCalledTimes(count);
	await runtime.receive({
		type: "prompt/send",
		requestId: "during",
		text: "hello",
	});
	expect(old.receive).not.toHaveBeenCalled();
	finish();
	await switching;
	expect(next.receive).toHaveBeenCalledWith(
		expect.objectContaining({ type: "connection/retry" }),
	);
	next.emit({
		type: "state/patch",
		revision: 1,
		patch: { sessionTitle: "new" },
	});
	expect(sidebar.mock.calls).toEqual(panel.mock.calls);
	const revisions = sidebar.mock.calls.flatMap(([event]: [HostMessage]) => {
		if (event.type === "state/patch") {
			return [event.revision];
		}
		if (event.type === "state/snapshot") {
			return [event.state.revision];
		}
		return [];
	});
	expect(revisions).toEqual([1, 2, 3, 4]);
	expect(runtime.snapshot().revision).toBe(4);
	await runtime.receive({ type: "session/new", requestId: "new" });
	expect(next.receive).toHaveBeenLastCalledWith({
		type: "session/new",
		requestId: "new",
	});
	runtime.invalidate();
	expect(next.invalidate).toHaveBeenCalledOnce();
	expect(old.invalidate).not.toHaveBeenCalled();
	await runtime.dispose();
	expect(next.dispose).toHaveBeenCalledOnce();
});

it("旧接続の終了待ちに拡張を終了しても、新しいバックエンドを起動しない", async () => {
	const old = backend();
	let finish!: () => void;
	old.dispose.mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	const factory = vi.fn(() => old);
	const runtime = new BackendRuntime(factory);
	const switching = runtime.restart();
	const closing = runtime.dispose();
	finish();
	await Promise.all([switching, closing]);
	expect(factory).toHaveBeenCalledOnce();
	expect(old.dispose).toHaveBeenCalledOnce();
});

it("生成失敗を表示して、再接続で設定から生成し直せる", async () => {
	const old = backend(),
		next = backend();
	const factory = vi
		.fn()
		.mockReturnValueOnce(old)
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
