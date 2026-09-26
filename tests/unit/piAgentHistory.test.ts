// 保存差分の復元、未完了処理の停止、破損記録と保存失敗を検証する。
import { expect, it, vi } from "vitest";
import { resolve } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	PiAgentHistory,
	restorePiAgentRecords,
} from "../../src/extension/backends/pi/PiAgentHistory";
import { PiAgentViews } from "../../src/extension/backends/pi/PiAgentViews";
import { assistant, piHarness } from "./piHarness";

/** JSONL と同じコピー境界を使い、SDK の記録操作だけを差し替える。 */
function fixture() {
	const entries: SessionEntry[] = [];
	const store = new PiAgentHistory({
		appendCustomEntry: (customType, data) => {
			entries.push({
				type: "custom",
				id: String(entries.length),
				parentId: null,
				timestamp: new Date().toISOString(),
				customType,
				data: structuredClone(data),
			});
			return String(entries.length);
		},
	});
	const views = new PiAgentViews((record) => store.write(record));
	views.parentId = "parent";
	return { entries, views };
}

it("差分で子の会話を保存し、フォーク先の親 ID で読み取り専用に復元する", async () => {
	const h = fixture();
	const id = h.views.start("delegate", "worker", "task", ".");
	h.views.status(id, "running");
	h.views.event(id, { type: "message_end", message: assistant("answer") });
	h.views.event(id, {
		type: "tool_execution_start",
		toolCallId: "write",
		toolName: "write",
		args: { path: "result.txt" },
	});
	h.views.event(id, {
		type: "tool_execution_end",
		toolCallId: "write",
		toolName: "write",
		result: { content: [{ type: "text", text: "saved" }] },
		isError: false,
	});
	h.views.status(id, "completed");
	const save = vi.fn();
	const restored = new PiAgentViews(save);
	restored.restore(restorePiAgentRecords(h.entries), "pi-1", ".");
	expect(restored.read(id)).toMatchObject({
		parentThreadId: "pi-1",
		messages: [{ text: "task" }, { text: "answer", streaming: false }],
		tools: [{ id: "write", status: "completed" }],
	});
	expect(restored.list()[0]!.status).toBe("completed");
	expect(save).not.toHaveBeenCalled();
	const controller = piHarness();
	controller.runtime.agentViews = restored;
	await controller.controller.connect();
	expect(controller.controller.snapshot().agents[0]!.threadId).toBe(id);
	expect(controller.runtime.prompt).not.toHaveBeenCalled();
	await controller.controller.dispose();
});

it("中断された子と未完了ツールを復元しても再実行しない", () => {
	const h = fixture();
	const id = h.views.start("delegate", "worker", "task", ".");
	h.views.status(id, "running");
	h.views.event(id, {
		type: "tool_execution_start",
		toolCallId: "pending",
		toolName: "write",
		args: {},
	});
	const restored = new PiAgentViews();
	restored.restore(restorePiAgentRecords(h.entries), "new-parent", ".");
	expect(restored.list()[0]!.status).toBe("interrupted");
	expect(restored.read(id).tools[0]!.status).toBe("cancelled");
});

it("移動したワークスペースでも子の相対作業ディレクトリを復元する", () => {
	const h = fixture();
	h.views.restore([], "parent", resolve("workspace"));
	const id = h.views.start(
		"delegate",
		"worker",
		"task",
		resolve("workspace/subdir"),
	);
	h.views.event(id, {
		type: "tool_execution_start",
		toolCallId: "read",
		toolName: "read",
		args: { path: "file.txt" },
	});
	const records = restorePiAgentRecords(h.entries);
	expect(records[0]!.cwd).toBe("subdir");
	const restored = new PiAgentViews();
	restored.restore(records, "parent", resolve("moved"));
	expect(restored.read(id).tools[0]!.cwd).toBe(resolve("moved/subdir"));
});

it("旧形式の親履歴は空の子一覧になり、破損した専用記録は明示的に拒否する", () => {
	expect(restorePiAgentRecords([])).toEqual([]);
	expect(() =>
		restorePiAgentRecords([
			{
				type: "custom",
				id: "bad",
				parentId: null,
				timestamp: "now",
				customType: "nerita.subagent.v1",
				data: { version: 1 },
			},
		]),
	).toThrow("破損");
});

it("イベントの保存失敗を終了時にも報告する", () => {
	const save = vi.fn();
	const views = new PiAgentViews(save);
	const id = views.start("delegate", "worker", "task", ".");
	save.mockImplementation(() => {
		throw new Error("disk full");
	});
	views.event(id, { type: "message_end", message: assistant("answer") });
	expect(() => views.status(id, "completed")).toThrow("disk full");
});
