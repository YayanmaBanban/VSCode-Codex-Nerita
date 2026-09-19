// App Serverの機能設定・逐次ツール・利用枠を実際の状態管理経路で検証する。
import { afterEach, expect, it, vi } from "vitest";
import { codexHarness } from "./codexHarness";
import { isHostMessage } from "../../src/shared/validation";
import { parseModels } from "../../src/extension/codex/protocol/account";
import { parseQuotaResponse } from "../../src/extension/codex/protocol/usage";

const sessions: ReturnType<typeof codexHarness>["session"][] = [];
afterEach(async () => {
	await Promise.all(sessions.splice(0).map((s) => s.dispose()));
});
/** 接続と検証済み通知を用意する。 */
async function ready() {
	const h = codexHarness();
	sessions.push(h.session);
	h.session.subscribe((event) => expect(isHostMessage(event)).toBe(true));
	await h.session.connect();
	return h;
}
it("端末出力の分割を連結し、完了本文で置換して遅いdeltaを排除する", async () => {
	const h = await ready();
	await h.send();
	const p = { threadId: "thread-1", turnId: "turn-1", itemId: "cmd" };
	h.notify("item/started", {
		...p,
		item: {
			id: "cmd",
			type: "commandExecution",
			command: "pwd",
			cwd: "D:/workspace",
		},
	});
	h.notify("item/commandExecution/outputDelta", { ...p, delta: "D:/" });
	h.notify("item/commandExecution/outputDelta", { ...p, delta: "workspace" });
	expect(h.session.snapshot().tools[0]?.rawOutput).toEqual({
		formatted_output: "D:/workspace",
	});
	h.notify("item/completed", {
		...p,
		item: {
			id: "cmd",
			type: "commandExecution",
			command: "pwd",
			cwd: "D:/workspace",
			status: "completed",
			aggregatedOutput: "final",
		},
	});
	h.notify("item/commandExecution/outputDelta", { ...p, delta: "late" });
	expect(h.session.snapshot().tools[0]?.rawOutput).toEqual({
		formatted_output: "final",
	});
});
it("推論の複数パート・計画・ファイル差分を保存する", async () => {
	const h = await ready();
	await h.send();
	const p = { threadId: "thread-1", turnId: "turn-1" };
	for (const [summaryIndex, delta] of [
		[0, "検討"],
		[1, "確認"],
	] as const) {
		h.notify("item/reasoning/summaryPartAdded", {
			...p,
			itemId: "reason",
			summaryIndex,
		});
		h.notify("item/reasoning/summaryTextDelta", {
			...p,
			itemId: "reason",
			summaryIndex,
			delta,
		});
	}
	expect(JSON.stringify(h.session.snapshot().tools[0]?.content)).toContain(
		"検討\\n\\n確認",
	);
	h.notify("turn/plan/updated", {
		...p,
		plan: [{ step: "変更する", status: "inProgress" }],
	});
	h.notify("item/fileChange/patchUpdated", {
		...p,
		itemId: "edit",
		changes: [{ path: "a.ts", diff: "@@ -1 +1 @@\n-old\n+new" }],
	});
	h.notify("turn/diff/updated", { ...p, diff: "diff --git a/a.ts b/a.ts" });
	h.complete();
	expect(
		h.session.snapshot().tools.find((t) => t.id === "edit")?.content?.[0],
	).toEqual({
		type: "unifiedDiff",
		path: "a.ts",
		diff: "@@ -1 +1 @@\n-old\n+new",
	});
	expect(
		h.session
			.snapshot()
			.tools.filter((t) => t.id.startsWith("turn:"))
			.every((t) => t.status === "completed"),
	).toBe(true);
});
it("別のturnのツール通知を適用しない", async () => {
	const h = await ready();
	await h.send();
	h.notify("item/commandExecution/outputDelta", {
		threadId: "thread-1",
		turnId: "old",
		itemId: "cmd",
		delta: "stale",
	});
	expect(h.session.snapshot().tools).toEqual([]);
});
it("使用量は現在のthreadだけを反映し、利用枠の残率を計算する", async () => {
	const h = await ready();
	h.notify("thread/tokenUsage/updated", {
		threadId: "other",
		tokenUsage: { last: { totalTokens: 10 }, modelContextWindow: 100 },
	});
	expect(h.session.snapshot().usage).toBeNull();
	h.notify("thread/tokenUsage/updated", {
		threadId: "thread-1",
		tokenUsage: {
			total: { totalTokens: 999 },
			last: { totalTokens: 10 },
			modelContextWindow: 100,
		},
	});
	expect(h.session.snapshot().usage).toEqual({ used: 10, size: 100 });
	h.notify("account/rateLimits/updated", {
		rateLimits: {
			primary: {
				usedPercent: 25,
				windowDurationMins: 300,
				resetsAt: null,
			},
			secondary: null,
		},
	});
	expect(h.session.snapshot().quota?.[0]).toMatchObject({
		label: "5時間",
		remaining: 75,
	});
	expect(() =>
		parseQuotaResponse({ rateLimits: { primary: { usedPercent: NaN } } }),
	).toThrow();
});
it("モデルカタログを検証し、将来の推論量を固定リストで捨てない", () => {
	const result = parseModels({
		data: [
			{
				model: "custom",
				displayName: "Custom",
				defaultReasoningEffort: "future",
				supportedReasoningEfforts: [
					{ reasoningEffort: "future", description: "Future effort" },
				],
				inputModalities: ["text", "audio"],
				serviceTiers: [],
			},
		],
		nextCursor: null,
	});
	expect(result.data[0]?.defaultReasoningEffort).toBe("future");
	expect(() =>
		parseModels({ data: [{ model: "custom" }], nextCursor: null }),
	).toThrow();
});
it("MCPの結果・失敗とエージェント実行をカードに変換する", async () => {
	const h = await ready();
	await h.send();
	h.notify("item/completed", {
		threadId: "thread-1",
		turnId: "turn-1",
		item: {
			id: "mcp",
			type: "mcpToolCall",
			server: "test",
			tool: "read",
			arguments: { q: "query" },
			status: "failed",
			result: null,
			error: { message: "error" },
		},
	});
	expect(h.session.snapshot().tools[0]).toMatchObject({
		title: "test / read",
		status: "failed",
		rawOutput: { message: "error" },
	});
});

it("モデル・推論量・権限を次のturnへ適用し実行中は変更しない", async () => {
	const h = codexHarness();
	sessions.push(h.session);
	h.client.listModels.mockResolvedValue({
		data: [
			{
				model: "test-model",
				displayName: "Test",
				defaultReasoningEffort: "medium",
				supportedReasoningEfforts: [
					{ reasoningEffort: "high", description: "High" },
				],
				inputModalities: ["text"],
				serviceTiers: [
					{ id: "priority", name: "Fast", description: "Fast" },
				],
			},
		],
		nextCursor: null,
	});
	await h.session.connect();
	const setting = (configId: string, value: string) =>
		h.session.receive({
			type: "config/set",
			requestId: crypto.randomUUID(),
			sessionId: "thread-1",
			configId,
			value,
		});
	await setting("reasoning_effort", "high");
	await setting("fast-mode", "on");
	await setting("mode", "read-only");
	await h.send();
	expect(h.client.startTurn).toHaveBeenCalledWith(
		expect.objectContaining({
			effort: "high",
			serviceTierForTurn: "priority",
			sandboxPolicy: { type: "readOnly", networkAccess: false },
		}),
	);
	const failed = vi.fn();
	h.session.subscribe(failed);
	await setting("mode", "danger-full-access");
	expect(failed).toHaveBeenCalledWith(
		expect.objectContaining({ type: "request/failed" }),
	);
	h.complete();
	await setting("fast-mode", "off");
	await h.send();
	expect(h.client.startTurn).toHaveBeenLastCalledWith(
		expect.objectContaining({ serviceTierForTurn: "default" }),
	);
});
