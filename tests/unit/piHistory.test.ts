// 履歴取得と復元の競合を検証し、失敗時は現在の会話を使用可能なまま残す。
import { expect, it, vi } from "vitest";
import { piHarness, pending } from "./piHarness";
import type { SessionSummary } from "../../src/shared/sessionHistory";
import { isHostMessage } from "../../src/shared/hostMessageValidation";

/** 保存SDKを差し替え、表示済み履歴を復元できるControllerを作る。 */
async function setup() {
	const h = piHarness();
	h.runtime.history = {
		entries: [],
		list: vi.fn(() =>
			Promise.resolve([
				{
					sessionId: "saved",
					cwd: "D:\\workspace",
					title: "保存した会話",
				},
			]),
		),
		target: (id) => ({
			id,
			directory: "D:\\workspace\\.sessions",
			storage: "workspace",
		}),
	};
	h.controller.subscribe((event) => expect(isHostMessage(event)).toBe(true));
	await h.controller.connect();
	const list = () =>
		h.controller.receive({
			type: "session/list",
			requestId: crypto.randomUUID(),
		});
	const load = (sessionId = "saved") =>
		h.controller.receive({
			type: "session/load",
			requestId: crypto.randomUUID(),
			sessionId,
		});
	await list();
	return { ...h, list, load };
}

it("一覧にないIDと実行中の復元を拒否する", async () => {
	const h = await setup();
	await h.load("unknown");
	await h.send();
	await h.load();
	expect(h.factory).toHaveBeenCalledTimes(1);
	await h.controller.dispose();
});

it("復元の成功後だけ切り替え、途中の送信と二重復元を拒否する", async () => {
	const h = await setup();
	const deferred = pending<Awaited<ReturnType<typeof h.factory>>>();
	h.factory.mockReturnValueOnce(deferred.promise);
	const loading = h.load();
	await vi.waitFor(() => expect(h.factory).toHaveBeenCalledTimes(2));
	await h.send("too early");
	await h.load();
	expect(h.runtime.prompt).not.toHaveBeenCalled();
	expect(h.controller.snapshot().sessionId).toBe("pi-1");
	const restored = {
		...h.runtime,
		sessionId: "saved",
		abort: vi.fn(() => Promise.resolve()),
		dispose: vi.fn(),
	};
	deferred.resolve({ session: restored, cwd: "D:\\workspace" });
	await loading;
	expect(h.controller.snapshot()).toMatchObject({
		sessionId: "saved",
		sessionPending: false,
		permissions: [],
		runId: null,
	});
	expect(h.runtime.dispose).toHaveBeenCalledOnce();
	await h.controller.dispose();
});

it("復元失敗後も現在の会話とその承認コールバックを使える", async () => {
	const h = await setup();
	const authorize = h.factory.mock.calls[0]![1];
	h.factory.mockRejectedValueOnce(new Error("missing file"));
	await h.load();
	expect(h.controller.snapshot()).toMatchObject({
		connection: "ready",
		sessionId: "pi-1",
		sessionPending: false,
		sessionsError: "missing file",
	});
	expect(h.runtime.dispose).not.toHaveBeenCalled();
	await h.send();
	const approval = authorize("write");
	const rejected = expect(approval).rejects.toThrow();
	expect(h.controller.snapshot().permissions).toHaveLength(1);
	await h.stop();
	await rejected;
	await h.controller.dispose();
});

it("切断後に完了した一覧と復元を新しい画面へ反映しない", async () => {
	const h = await setup();
	const deferred = pending<SessionSummary[]>();
	h.runtime.history!.list = () => deferred.promise;
	const listing = h.list();
	h.controller.invalidate();
	deferred.resolve([{ sessionId: "stale", cwd: "old" }]);
	await listing;
	expect(h.controller.snapshot().sessions).toEqual([]);
	await h.controller.dispose();
});
