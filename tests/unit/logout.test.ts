// 認証解除の両入口と、失敗・競合時に会話を失わない境界を検証する。
import { expect, it, vi } from "vitest";
import { codexHarness, deferred } from "./codexHarness";
import { isUiMessage } from "../../src/shared/uiMessageValidation";
import { responseParsers } from "../../src/extension/codex/protocol/responses";

it("ログアウト要求とRPC応答を境界で検証する", () => {
	expect(isUiMessage({ type: "auth/logout", requestId: "logout" })).toBe(
		true,
	);
	expect(isUiMessage({ type: "auth/logout" })).toBe(false);
	expect(responseParsers["account/logout"]({})).toEqual({});
	expect(() => responseParsers["account/logout"](null)).toThrow();
});

for (const slash of [false, true]) {
	it(`ログアウト後に認証待ちへ戻り、モデルには送らない: ${slash}`, async () => {
		const h = codexHarness();
		try {
			await h.session.connect();
			const listener = vi.fn();
			h.session.subscribe(listener);
			h.client.readAccount.mockResolvedValue({
				authenticated: false,
				requiresOpenaiAuth: true,
			});
			if (slash) {
				await h.send(" /logout \n");
			} else {
				await h.session.receive({
					type: "auth/logout",
					requestId: "logout",
				});
			}
			expect(h.client.logout).toHaveBeenCalledTimes(1);
			expect(h.client.dispose).toHaveBeenCalledTimes(1);
			expect(h.client.startTurn).not.toHaveBeenCalled();
			expect(h.session.snapshot()).toMatchObject({
				connection: "auth-required",
				sessionId: null,
				messages: [],
				sessionPending: false,
			});
			if (slash) {
				expect(listener).toHaveBeenCalledWith(
					expect.objectContaining({ type: "prompt/accepted" }),
				);
			}
		} finally {
			await h.session.dispose();
		}
	});
}

it("失敗時は会話を保持し、実行中のログアウトを拒否する", async () => {
	const h = codexHarness();
	try {
		await h.session.connect();
		const before = h.session.snapshot().sessionId;
		const listener = vi.fn();
		h.session.subscribe(listener);
		h.client.logout.mockRejectedValueOnce(new Error("failed"));
		await h.send("/logout");
		expect(h.session.snapshot()).toMatchObject({
			connection: "ready",
			sessionId: before,
			sessionPending: false,
		});
		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({ type: "request/failed" }),
		);
		await h.send("hello");
		await h.send("/logout");
		await h.session.receive({ type: "auth/logout", requestId: "busy" });
		expect(h.client.logout).toHaveBeenCalledTimes(1);
	} finally {
		await h.session.dispose();
	}
});

it("解除中の二重操作を拒否し、古い応答で再接続しない", async () => {
	const h = codexHarness();
	const pending = deferred<Record<string, never>>();
	try {
		await h.session.connect();
		h.client.logout.mockReturnValueOnce(pending.promise);
		const request = h.send("/logout");
		await h.session.receive({
			type: "auth/logout",
			requestId: "duplicate",
		});
		expect(h.client.logout).toHaveBeenCalledTimes(1);
		h.session.invalidate();
		pending.resolve({});
		await request;
		expect(h.factory).toHaveBeenCalledTimes(1);
		expect(h.session.snapshot().connection).toBe("disconnected");
	} finally {
		await h.session.dispose();
	}
});
