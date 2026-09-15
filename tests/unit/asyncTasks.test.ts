// AIR通知・カードの対応・ターンをまたいだ停止・失敗時の再試行を検証する。
import { expect, it, vi } from "vitest";
import { fixture, deferred } from "./fakeTransport";
import {
	consumeTaskUpdate,
	supportsAsyncTasks,
} from "../../src/extension/acp/airTasks";
import { updateAsyncTasks } from "../../src/extension/session/asyncTasks";
import { initialState } from "../../src/shared/messages";
import { isHostMessage, isUiMessage } from "../../src/shared/validation";

it("AIRの宣言・拡張通知を検証し、別セッションを混ぜない", () => {
	expect(
		supportsAsyncTasks({
			jetbrains: { air: { version: 1, capabilities: ["asyncTasks"] } },
		}),
	).toBe(true);
	expect(supportsAsyncTasks({})).toBe(false);
	const receive = vi.fn();
	expect(
		consumeTaskUpdate(
			{
				sessionId: "s",
				update: {
					sessionUpdate: "async_task_spawned",
					asyncTaskId: "child:cmd",
					toolCallId: "cmd",
					canStop: true,
				},
			},
			receive,
		),
	).toBe(true);
	expect(receive).toHaveBeenCalledWith({
		sessionId: "s",
		spawned: true,
		task: {
			asyncTaskId: "child:cmd",
			toolCallId: "cmd",
			canStop: true,
			state: "running",
		},
	});
	consumeTaskUpdate(
		{
			sessionId: "s",
			update: { sessionUpdate: "async_task_spawned", canStop: "yes" },
		},
		receive,
	);
	expect(receive).toHaveBeenCalledTimes(1);
	expect(
		updateAsyncTasks(initialState(), {
			sessionId: "other",
			spawned: true,
			task: { asyncTaskId: "a", canStop: true, state: "running" },
		}),
	).toEqual({});
	expect(
		isHostMessage({ type: "state/snapshot", state: initialState() }),
	).toBe(true);
	expect(
		isUiMessage({
			type: "execution/stop",
			requestId: "r",
			sessionId: "s",
			runId: "run",
			toolId: "cmd",
		}),
	).toBe(true);
});

it("タスクIDを推測せず停止し、終了後の通知と失敗・再試行を扱う", async () => {
	const { controller, connections } = fixture();
	await controller.connect();
	const connection = connections[0]!;
	const sessionId = controller.snapshot().sessionId!;
	const turn = controller.receive({
		type: "prompt/send",
		requestId: "p",
		sessionId,
		text: "run",
	});
	try {
		connection.callbacks.update({
			sessionId,
			update: {
				sessionUpdate: "tool_call",
				toolCallId: "cmd",
				title: "test",
				kind: "execute",
				status: "completed",
			},
		});
		connection.callbacks.asyncTask?.({
			sessionId,
			spawned: true,
			task: {
				asyncTaskId: "child:cmd",
				toolCallId: "cmd",
				canStop: true,
				state: "running",
			},
		});
		const request = {
			type: "execution/stop",
			requestId: "stop",
			sessionId,
			runId: controller.snapshot().runId!,
			toolId: "cmd",
		};
		connection.result.resolve({ stopReason: "end_turn" });
		await turn;
		connection.callbacks.update({
			sessionId,
			update: {
				sessionUpdate: "tool_call_update",
				toolCallId: "cmd",
				rawOutput: { formatted_output: "background output" },
			},
		});
		expect(controller.snapshot().tools).toHaveLength(1);
		expect(controller.snapshot().tools[0]?.rawOutput).toEqual({
			formatted_output: "background output",
		});
		for (const invalid of [
			{ sessionId: "old" },
			{ runId: "old" },
			{ toolId: "missing" },
		]) {
			await controller.receive({
				...request,
				...invalid,
				requestId: JSON.stringify(invalid),
			});
		}
		expect(connection.transport.stopAsyncTask).not.toHaveBeenCalled();
		const pending = deferred<void>();
		vi.mocked(connection.transport.stopAsyncTask).mockReturnValueOnce(
			pending.promise,
		);
		const stopping = controller.receive(request);
		await controller.receive({ ...request, requestId: "duplicate" });
		expect(
			connection.transport.stopAsyncTask,
		).toHaveBeenCalledExactlyOnceWith(sessionId, "child:cmd");
		pending.reject(new Error("not stopped"));
		await stopping;
		expect(controller.snapshot().asyncTasks[0]?.stopPending).toBe(false);
		await controller.receive({ ...request, requestId: "retry" });
		connection.callbacks.asyncTask?.({
			sessionId,
			spawned: false,
			task: {
				asyncTaskId: "child:cmd",
				state: "stopped",
				canStop: false,
			},
		});
		await controller.receive({ ...request, requestId: "finished" });
		expect(connection.transport.stopAsyncTask).toHaveBeenCalledTimes(2);
		expect(connection.transport.cancel).not.toHaveBeenCalled();
		expect(controller.snapshot().asyncTasks[0]).toMatchObject({
			state: "stopped",
			toolCallId: "cmd",
			canStop: false,
		});
		connection.callbacks.asyncTask?.({
			sessionId,
			spawned: true,
			task: { asyncTaskId: "child:cmd", canStop: true, state: "running" },
		});
		expect(controller.snapshot().asyncTasks[0]?.state).toBe("stopped");
	} finally {
		await controller.dispose();
		await turn;
	}
});
