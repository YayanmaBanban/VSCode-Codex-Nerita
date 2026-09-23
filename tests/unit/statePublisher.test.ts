// 出力集約の順序、差分復元、緊急通知と破棄を検証する。
import { afterEach, expect, test, vi } from "vitest";
import { StatePublisher } from "../../src/extension/session/statePublisher";
import { initialState, type ToolSummary } from "../../src/shared/chatState";
import type { HostMessage } from "../../src/shared/messages";
import { isHostMessage } from "../../src/shared/hostMessageValidation";
import {
	applyToolUpdates,
	applyStatePatch,
} from "../../src/shared/toolUpdates";

afterEach(() => vi.useRealTimers());

test("連続出力を最新のカード差分へ集約し完了は即配信する", () => {
	vi.useFakeTimers();
	const events: HostMessage[] = [];
	const publisher = new StatePublisher((event) => events.push(event));
	const tool: ToolSummary = {
		id: "command",
		runId: "run",
		title: "command",
		kind: "execute",
		status: "in_progress",
		paths: [],
	};
	const other = { ...tool, id: "other" };
	publisher.publish({
		type: "state/snapshot",
		state: { ...initialState(), tools: [tool, other] },
	});
	for (let revision = 1; revision <= 100; revision++) {
		publisher.publish({
			type: "state/patch",
			revision,
			patch: {
				tools: [
					{
						...tool,
						rawOutput: { formatted_output: String(revision) },
					},
					other,
				],
			},
		});
	}
	expect(events).toHaveLength(1);
	vi.advanceTimersByTime(50);
	const delta = events[1]!;
	expect(isHostMessage(delta)).toBe(true);
	if (delta.type !== "state/patch") {
		throw new Error("Expected patch");
	}
	expect(delta.baseRevision).toBe(0);
	expect(delta.revision).toBe(100);
	expect(delta.patch.tools).toBeUndefined();
	expect(delta.toolUpdates).toHaveLength(1);
	const restored = applyToolUpdates([tool, other], delta.toolUpdates!);
	expect(restored[0]!.rawOutput).toEqual({ formatted_output: "100" });
	expect(restored[1]).toBe(other);
	publisher.publish({
		type: "state/patch",
		revision: 101,
		patch: { tools: [{ ...restored[0]!, rawOutput: "last" }, other] },
	});
	publisher.publish({
		type: "state/patch",
		revision: 102,
		patch: {
			tools: [
				{ ...restored[0]!, status: "completed", rawOutput: "last" },
				other,
			],
		},
	});
	expect(events).toHaveLength(3);
	expect(events[2]).toMatchObject({
		baseRevision: 100,
		revision: 102,
		toolUpdates: [{ status: "completed", rawOutput: "last" }],
	});
	vi.runAllTimers();
	expect(events).toHaveLength(3);
});

test("削除・セッション切り替えは全置換し破棄後は送信しない", () => {
	vi.useFakeTimers();
	const send = vi.fn();
	const publisher = new StatePublisher(send);
	const tool: ToolSummary = {
		id: "same",
		title: "command",
		status: "in_progress",
		paths: [],
	};
	publisher.publish({
		type: "state/patch",
		revision: 1,
		patch: { tools: [tool] },
	});
	publisher.publish({
		type: "state/patch",
		revision: 2,
		patch: { tools: [] },
	});
	expect(send.mock.lastCall![0]).toMatchObject({ patch: { tools: [] } });
	publisher.publish({
		type: "state/patch",
		revision: 3,
		patch: { sessionId: "new", tools: [tool] },
	});
	expect(send.mock.lastCall![0]).toMatchObject({
		patch: { sessionId: "new", tools: [tool] },
	});
	publisher.publish({
		type: "state/patch",
		revision: 4,
		patch: { tools: [{ ...tool, rawOutput: "pending" }] },
	});
	publisher.dispose();
	vi.runAllTimers();
	expect(send).toHaveBeenCalledTimes(3);
});

test("不正な集約範囲と配列置換の混在を拒否する", () => {
	expect(
		isHostMessage({
			type: "state/patch",
			revision: 2,
			baseRevision: 2,
			patch: {},
		}),
	).toBe(false);
	expect(
		isHostMessage({
			type: "state/patch",
			revision: 2,
			toolUpdates: [],
			patch: { tools: [] },
		}),
	).toBe(false);
	expect(
		isHostMessage({
			type: "state/patch",
			revision: 2,
			toolUpdates: [{}],
			patch: {},
		}),
	).toBe(false);
});

test("停止通知は保留出力と即時配信しスナップショット後も差分を復元する", () => {
	vi.useFakeTimers();
	const events: HostMessage[] = [];
	const publisher = new StatePublisher((event) => events.push(event));
	const tool: ToolSummary = {
		id: "same",
		runId: "first",
		title: "command",
		status: "in_progress",
		paths: [],
	};
	let current = { ...initialState(), tools: [tool] };
	publisher.publish({ type: "state/snapshot", state: current });
	publisher.publish({
		type: "state/patch",
		revision: 1,
		patch: { tools: [{ ...tool, rawOutput: "latest" }] },
	});
	publisher.publish({
		type: "state/patch",
		revision: 2,
		patch: {
			asyncTasks: [
				{
					asyncTaskId: "task",
					toolCallId: "same",
					state: "stopped",
					canStop: false,
				},
			],
		},
	});
	expect(events).toHaveLength(2);
	const stopped = events[1]!;
	if (stopped.type !== "state/patch") {
		throw new Error("Expected patch");
	}
	current = applyStatePatch(current, stopped);
	expect(current.tools[0]!.rawOutput).toBe("latest");
	expect(current.asyncTasks[0]!.state).toBe("stopped");
	publisher.publish({ type: "state/snapshot", state: current });
	const appended = { ...tool, runId: "second" };
	publisher.publish({
		type: "state/patch",
		revision: 3,
		patch: { tools: [...current.tools, appended] },
	});
	const added = events[3]!;
	if (added.type !== "state/patch") {
		throw new Error("Expected patch");
	}
	expect(added.toolUpdates).toEqual([appended]);
	current = applyStatePatch(current, added);
	expect(current.tools.map((entry) => entry.runId)).toEqual([
		"first",
		"second",
	]);
	publisher.publish({
		type: "state/patch",
		revision: 4,
		patch: { tools: [...current.tools].reverse() },
	});
	expect(events[4]).toMatchObject({
		patch: { tools: [...current.tools].reverse() },
	});
	vi.runAllTimers();
	expect(events).toHaveLength(5);
});
