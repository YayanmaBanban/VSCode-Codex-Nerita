// 承認回答・取消・サーバー側解決を、同じ request ID とターンに限定して検証する。
import { afterEach, expect, it, vi } from "vitest";
import { ServerRequests } from "../../src/extension/codex/runtime/ServerRequests";
import { codexHarness } from "./codexHarness";
import type { CodexSessionController } from "../../src/extension/codex/CodexSessionController";

const sessions: CodexSessionController[] = [];
afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.dispose()));
});
/** 通信の要求受付と UI の承認管理を接続する。 */
async function setup() {
	const harness = codexHarness();
	sessions.push(harness.session);
	await harness.session.connect();
	await harness.send();
	const write = vi.fn();
	const requests = new ServerRequests(
		write,
		harness.connections[0]!.callbacks.request,
	);
	return { ...harness, write, requests };
}
/** テストの承認対象を同じ実行に揃える。 */
const params = {
	threadId: "thread-1",
	turnId: "turn-1",
	itemId: "tool",
	command: "Write-Output 'hello'",
	cwd: "D:/workspace",
	reason: "確認が必要",
};

it.each([
	"item/commandExecution/requestApproval",
	"item/fileChange/requestApproval",
])("%s に対し許可・拒否を元の ID へ一度だけ返す", async (method) => {
	const { session, requests, write } = await setup();
	requests.accept({ method, id: 7, params });
	requests.accept({ method, id: "7", params });
	await vi.waitFor(() =>
		expect(session.snapshot().permissions).toHaveLength(2),
	);
	const [accept, decline] = session.snapshot().permissions;
	for (const [permission, decision] of [
		[accept!, "accept"],
		[decline!, "decline"],
	] as const) {
		const message = {
			type: "permission/respond",
			requestId: crypto.randomUUID(),
			sessionId: "thread-1",
			runId: session.snapshot().runId,
			permissionId: permission.id,
			optionId: decision,
		};
		await session.receive(message);
		await session.receive(message);
	}
	await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
	expect(write).toHaveBeenCalledWith({
		id: 7,
		result: { decision: "accept" },
	});
	expect(write).toHaveBeenCalledWith({
		id: "7",
		result: { decision: "decline" },
	});
	expect(session.snapshot().permissions).toEqual([]);
	requests.dispose();
});

it("serverRequest/resolved は UI を消し、遅い回答を送らない", async () => {
	const { session, requests, write } = await setup();
	requests.accept({
		method: "item/commandExecution/requestApproval",
		id: "a",
		params,
	});
	await vi.waitFor(() =>
		expect(session.snapshot().permissions).toHaveLength(1),
	);
	requests.resolved({ threadId: "other", requestId: "a" });
	expect(session.snapshot().permissions).toHaveLength(1);
	requests.resolved({ threadId: "thread-1", requestId: "a" });
	await vi.waitFor(() => expect(session.snapshot().permissions).toEqual([]));
	expect(write).not.toHaveBeenCalled();
});

it("Stop は保留承認を cancel として解消する", async () => {
	const { session, requests, write, cancel } = await setup();
	requests.accept({
		method: "item/fileChange/requestApproval",
		id: "a",
		params,
	});
	await vi.waitFor(() =>
		expect(session.snapshot().permissions).toHaveLength(1),
	);
	await cancel();
	await vi.waitFor(() =>
		expect(write).toHaveBeenCalledWith({
			id: "a",
			result: { decision: "cancel" },
		}),
	);
	expect(session.snapshot().permissions).toEqual([]);
	requests.dispose();
});

it("完了後や別ターンの承認を表示せず、cancel を返す", async () => {
	const { session, requests, write, complete } = await setup();
	requests.accept({
		method: "item/fileChange/requestApproval",
		id: "old",
		params: { ...params, turnId: "old" },
	});
	await vi.waitFor(() =>
		expect(write).toHaveBeenCalledWith({
			id: "old",
			result: { decision: "cancel" },
		}),
	);
	complete();
	requests.accept({
		method: "item/fileChange/requestApproval",
		id: "late",
		params,
	});
	await vi.waitFor(() =>
		expect(write).toHaveBeenCalledWith({
			id: "late",
			result: { decision: "cancel" },
		}),
	);
	expect(session.snapshot().permissions).toEqual([]);
	requests.dispose();
});

it("切断では保留承認を消し、閉じた接続へ回答しない", async () => {
	const { session, requests, write } = await setup();
	requests.accept({
		method: "item/fileChange/requestApproval",
		id: "a",
		params,
	});
	await vi.waitFor(() =>
		expect(session.snapshot().permissions).toHaveLength(1),
	);
	requests.dispose();
	await vi.waitFor(() => expect(session.snapshot().permissions).toEqual([]));
	expect(write).not.toHaveBeenCalled();
});

it("未対応要求と不正な承認には RPC エラーを返す", async () => {
	const { requests, write } = await setup();
	requests.accept({ method: "item/tool/call", id: 1, params });
	requests.accept({
		method: "item/fileChange/requestApproval",
		id: 2,
		params: {},
	});
	await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
	expect(write).toHaveBeenCalledWith({
		id: 1,
		error: { code: -32601, message: "Method not supported by this client" },
	});
	expect(write).toHaveBeenCalledWith({
		id: 2,
		error: { code: -32602, message: "Invalid approval request" },
	});
	requests.dispose();
});
