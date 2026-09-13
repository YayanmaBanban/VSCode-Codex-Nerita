// Host の排他制御、遅延通知、承認と切断の回帰テスト。
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostMessage } from "../../src/shared/messages";
import { fixture, permissionRequest } from "./fakeTransport";

const fixtures: ReturnType<typeof fixture>[] = [];
/** 接続済みのテスト用 Host を作る。 */
async function setup() {
	const f = fixture();
	fixtures.push(f);
	await f.controller.connect();
	return f;
}
afterEach(async () => {
	for (const f of fixtures.splice(0)) {
		await f.controller.dispose();
	}
	vi.useRealTimers();
});
describe("SessionController", () => {
	it("ready で正本を復元し、購読解除後は通知しない", async () => {
		const { controller } = await setup();
		const events: HostMessage[] = [];
		const unsubscribe = controller.subscribe((e) => events.push(e));
		await controller.receive({ type: "ui/ready" });
		expect(events[0]).toEqual({
			type: "state/snapshot",
			state: controller.snapshot(),
		});
		unsubscribe();
		await controller.receive({ type: "ui/ready" });
		expect(events).toHaveLength(1);
		const snapshot = controller.snapshot();
		snapshot.messages.push({ id: "bad", role: "user", text: "bad" });
		expect(controller.snapshot().messages).toEqual([]);
	});
	it("不正要求・別会話・重複送信を拒否し、応答を逐次追加する", async () => {
		const { controller, connections } = await setup();
		const connection = connections[0]!;
		const sessionId = controller.snapshot().sessionId!;
		await controller.receive({
			type: "prompt/send",
			requestId: "bad",
			sessionId,
			text: " ",
		});
		await controller.receive({
			type: "prompt/send",
			requestId: "stale",
			sessionId: "other",
			text: "bad",
		});
		const request = {
			type: "prompt/send",
			requestId: "send",
			sessionId,
			text: "hello",
		};
		const turn = controller.receive(request);
		await controller.receive(request);
		await controller.receive({ ...request, requestId: "another" });
		expect(connection.transport.prompt).toHaveBeenCalledTimes(1);
		for (const text of ["こん", "にちは"]) {
			connection.callbacks.update({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text },
				},
			});
		}
		expect(controller.snapshot().messages[1]?.text).toBe("こんにちは");
		connection.result.resolve({ stopReason: "end_turn" });
		await turn;
		expect(controller.snapshot().run).toBe("completed");
	});
	it("承認を一度だけ解決し、未知の選択肢を拒否する", async () => {
		const { controller, connections } = await setup();
		const connection = connections[0]!;
		const sessionId = controller.snapshot().sessionId!;
		const turn = controller.receive({
			type: "prompt/send",
			requestId: "send",
			sessionId,
			text: "hello",
		});
		const answer = connection.callbacks.permission(
			permissionRequest(sessionId),
		);
		const permissionId = controller.snapshot().permissions[0]!.id;
		const runId = controller.snapshot().runId!;
		await controller.receive({
			type: "permission/respond",
			requestId: "bad",
			sessionId,
			runId,
			permissionId,
			optionId: "invalid",
		});
		expect(controller.snapshot().permissions).toHaveLength(1);
		await controller.receive({
			type: "permission/respond",
			requestId: "ok",
			sessionId,
			runId,
			permissionId,
			optionId: "reject",
		});
		expect(await answer).toEqual({
			outcome: { outcome: "selected", optionId: "reject" },
		});
		await controller.receive({
			type: "permission/respond",
			requestId: "duplicate",
			sessionId,
			runId,
			permissionId,
			optionId: "allow",
		});
		expect(controller.snapshot().permissions).toEqual([]);
		connection.result.resolve({ stopReason: "end_turn" });
		await turn;
	});
	it("切断時に承認を取消し、再接続後の古い通知と完了を無視する", async () => {
		const { controller, connections } = await setup();
		const old = connections[0]!;
		const sessionId = controller.snapshot().sessionId!;
		const turn = controller.receive({
			type: "prompt/send",
			requestId: "send",
			sessionId,
			text: "hello",
		});
		const answer = old.callbacks.permission(permissionRequest(sessionId));
		old.callbacks.disconnected();
		expect(await answer).toEqual({ outcome: { outcome: "cancelled" } });
		expect(controller.snapshot().connection).toBe("error");
		await controller.receive({
			type: "connection/retry",
			requestId: "retry",
		});
		old.callbacks.update({
			sessionId,
			update: {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "stale" },
			},
		});
		await turn;
		expect(controller.snapshot().messages).toEqual([]);
		expect(controller.snapshot().connection).toBe("ready");
		expect(connections[1]!.transport.prompt).not.toHaveBeenCalled();
	});
	it("停止待ちで二重実行を防ぎ、期限後にプロセスを終了する", async () => {
		vi.useFakeTimers();
		const { controller, connections } = await setup();
		const c = connections[0]!;
		const sessionId = controller.snapshot().sessionId!;
		const turn = controller.receive({
			type: "prompt/send",
			requestId: "send",
			sessionId,
			text: "hello",
		});
		const answer = c.callbacks.permission(permissionRequest(sessionId));
		await controller.receive({
			type: "prompt/cancel",
			requestId: "cancel",
			sessionId,
			runId: controller.snapshot().runId!,
		});
		expect(await answer).toEqual({ outcome: { outcome: "cancelled" } });
		expect(controller.snapshot().run).toBe("cancelling");
		c.callbacks.update({
			sessionId,
			update: {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "late" },
			},
		});
		await vi.advanceTimersByTimeAsync(5000);
		await turn;
		expect(c.transport.dispose).toHaveBeenCalled();
		expect(controller.snapshot().run).toBe("cancelled");
		expect(controller.snapshot().messages).toHaveLength(1);
	});
	it("認証不足とプロンプト失敗を表示し、未提示の認証方式を拒否する", async () => {
		const f = fixture();
		fixtures.push(f);
		const connecting = f.controller.connect();
		await Promise.resolve();
		vi.mocked(f.connections[0]!.transport.newSession).mockRejectedValueOnce(
			{ code: -32000 },
		);
		await connecting;
		expect(f.controller.snapshot().connection).toBe("auth-required");
		await f.controller.receive({
			type: "auth/start",
			requestId: "invalid",
			methodId: "other",
		});
		expect(f.connections[0]!.transport.authenticate).not.toHaveBeenCalled();
		await f.controller.receive({
			type: "auth/start",
			requestId: "login",
			methodId: "chat-gpt",
		});
		expect(f.controller.snapshot().connection).toBe("ready");
		const turn = f.controller.receive({
			type: "prompt/send",
			requestId: "send",
			sessionId: f.controller.snapshot().sessionId!,
			text: "hello",
		});
		f.connections[0]!.result.reject(new Error("private diagnostic"));
		await turn;
		expect(f.controller.snapshot().run).toBe("failed");
		expect(f.controller.snapshot().error).not.toContain(
			"private diagnostic",
		);
	});
});
