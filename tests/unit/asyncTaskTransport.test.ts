// AIR通知がSDKに破棄されず、ターン後の個別停止まで往復できることを検証する。
import { expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { createTransport } from "../../src/extension/acp/transport";
import type { TaskUpdate } from "../../src/extension/acp/airTasks";

it("AIR対応を宣言し、spawn・state通知と専用停止APIを処理する", async () => {
	const events: string[] = [];
	const asyncTask = vi.fn((update: TaskUpdate) => {
		events.push(update.task.state);
	});
	const transport = createTransport(
		process.execPath,
		resolve("tests/fixtures/async-task-agent.mjs"),
		process.cwd(),
		{
			update: () => {
				events.push("tool");
			},
			asyncTask,
			permission: () =>
				Promise.resolve({ outcome: { outcome: "cancelled" } }),
			disconnected: vi.fn(),
		},
		vi.fn(),
	);
	try {
		await transport.initialize();
		const { sessionId } = await transport.newSession();
		await transport.prompt(sessionId, "test");
		expect(events).toEqual(["tool", "running"]);
		expect(asyncTask.mock.calls[0]?.[0].task).toMatchObject({
			asyncTaskId: "child:cmd",
			toolCallId: "cmd",
		});
		await expect(
			transport.stopAsyncTask(sessionId, "incorrect-id"),
		).rejects.toThrow("Task not stopped");
		await transport.stopAsyncTask(sessionId, "child:cmd");
		expect(events).toEqual(["tool", "running", "stopped"]);
	} finally {
		await transport.dispose();
	}
});
