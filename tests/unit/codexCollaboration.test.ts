// モード選択から実際の送信引数・逐次表示までを状態管理経路で検証する。
import { afterEach, expect, it, vi } from "vitest";
import { codexHarness, deferred } from "./codexHarness";
import { completionItems } from "../../src/webview/chat/composer/completionItems";
import type { SandboxPolicy } from "../../src/extension/backends/codex/codex-app-server/v2/SandboxPolicy";

const sessions: ReturnType<typeof codexHarness>["session"][] = [];
afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.dispose()));
});

/** 有効なモデル候補と設定操作を用意する。 */
async function ready(initialSandbox?: SandboxPolicy) {
	const h = codexHarness();
	sessions.push(h.session);
	if (initialSandbox) {
		h.client.startThread.mockResolvedValueOnce({
			thread: { id: "thread-1" },
			model: "test-model",
			cwd: "D:/workspace",
			sandbox: initialSandbox,
		});
	}
	h.client.listModels.mockResolvedValue({
		data: ["test-model", "other-model"].map((model) => ({
			model,
			displayName: model,
			defaultReasoningEffort: "medium",
			supportedReasoningEfforts: [
				{ reasoningEffort: "medium", description: "Medium" },
				{ reasoningEffort: "high", description: "High" },
			],
			inputModalities: ["text"],
			serviceTiers: [],
		})),
		nextCursor: null,
	});
	await h.session.connect();
	const setting = (value: string, configId = "collaboration_mode") =>
		h.session.receive({
			type: "config/set",
			requestId: crypto.randomUUID(),
			sessionId: h.session.snapshot().sessionId,
			configId,
			value,
		});
	return { ...h, setting };
}

/** Plan項目を確定し、実装先カードを表示可能にする。 */
async function completedPlan(h: Awaited<ReturnType<typeof ready>>) {
	await h.setting("plan");
	await h.send("計画を作成");
	h.notify("item/completed", {
		threadId: "thread-1",
		turnId: "turn-1",
		item: { type: "plan", id: "plan-1", text: "## 実装計画\n変更する" },
	});
	h.complete();
	expect(h.session.snapshot().planDecision?.text).toBe(
		"## 実装計画\n変更する",
	);
}

it("新規セッションの最初のターンにモデル・推論レベル・明示権限を引き継ぐ", async () => {
	const h = await ready();
	await h.setting("other-model", "model");
	await h.setting("high", "reasoning_effort");
	await h.setting("read-only", "mode");
	await completedPlan(h);
	await h.session.receive({
		type: "plan/decide",
		requestId: crypto.randomUUID(),
		sessionId: "thread-1",
		runId: h.session.snapshot().planDecision?.runId,
		action: "new",
	});
	const state = h.session.snapshot();
	expect(state.sessionId).toBe("thread-2");
	expect(
		Object.fromEntries(
			state.configOptions.map((option) => [
				option.id,
				option.currentValue,
			]),
		),
	).toMatchObject({
		model: "other-model",
		reasoning_effort: "high",
		mode: "read-only",
		collaboration_mode: "default",
	});
	const turn = h.client.startTurn.mock.calls.at(-1)?.[0];
	expect(turn).toMatchObject({
		threadId: "thread-2",
		model: "other-model",
		effort: "high",
		sandboxPolicy: { type: "readOnly", networkAccess: false },
		collaborationMode: { mode: "default" },
	});
	expect(JSON.stringify(turn?.input)).toContain("## 実装計画\\n変更する");
});

it("権限が引き継ぐ設定なら元の会話の実効sandboxを使用する", async () => {
	const original: SandboxPolicy = { type: "readOnly", networkAccess: true };
	const h = await ready(original);
	h.client.startThread.mockResolvedValueOnce({
		thread: { id: "thread-2" },
		model: "test-model",
		cwd: "D:/workspace",
		sandbox: { type: "dangerFullAccess" },
	});
	await completedPlan(h);
	await h.session.receive({
		type: "plan/decide",
		requestId: crypto.randomUUID(),
		sessionId: "thread-1",
		runId: h.session.snapshot().planDecision?.runId,
		action: "new",
	});
	expect(
		h.session
			.snapshot()
			.configOptions.find((option) => option.id === "mode")?.currentValue,
	).toBe("inherit");
	expect(h.client.startTurn).toHaveBeenLastCalledWith(
		expect.objectContaining({
			threadId: "thread-2",
			sandboxPolicy: original,
		}),
	);
});

it("Plan選択は履歴とモデル設定を保ち、次のターンを組み立てる", async () => {
	const h = await ready();
	await h.send("最初の会話");
	h.complete();
	const messages = h.session.snapshot().messages;
	await h.setting("plan");
	expect(h.client.startThread).toHaveBeenCalledTimes(1);
	expect(h.client.startTurn).toHaveBeenCalledTimes(1);
	expect(h.session.snapshot().messages).toEqual(messages);
	await h.setting("high", "reasoning_effort");
	await h.setting("other-model", "model");
	expect(
		h.session
			.snapshot()
			.configOptions.find((item) => item.id === "collaboration_mode")
			?.currentValue,
	).toBe("plan");
	await h.send("実装計画を作る");
	expect(h.client.startTurn).toHaveBeenLastCalledWith(
		expect.objectContaining({
			collaborationMode: {
				mode: "plan",
				settings: {
					model: "other-model",
					reasoning_effort: "high",
					developer_instructions: null,
				},
			},
		}),
	);
	h.complete();
	await h.setting("default");
	expect(h.client.updateCollaborationMode).toHaveBeenCalledWith("thread-1", {
		mode: "default",
		settings: {
			model: "other-model",
			reasoning_effort: "high",
			developer_instructions: null,
		},
	});
	await h.send("実装する");
	expect(
		h.client.startTurn.mock.calls.at(-1)?.[0].collaborationMode?.mode,
	).toBe("default");
});

it("Goal選択は通信せず、送信時だけ接頭辞を付けてPlanを解除する", async () => {
	const h = await ready();
	await h.setting("plan");
	await h.setting("goal");
	expect(h.client.startTurn).not.toHaveBeenCalled();
	expect(h.client.updateCollaborationMode).not.toHaveBeenCalled();
	await h.send("テストを通す");
	expect(h.client.startTurn).toHaveBeenLastCalledWith(
		expect.objectContaining({
			input: [
				{ type: "text", text: "/goal テストを通す", text_elements: [] },
			],
		}),
	);
	expect(
		h.client.startTurn.mock.calls.at(-1)?.[0].collaborationMode?.mode,
	).toBe("default");
	h.complete();
	await h.send("/goal テストを通す");
	expect(h.session.snapshot().messages.at(-1)?.text).toBe(
		"/goal テストを通す",
	);
});

it("スラッシュ単体はモード変更、本文付きPlanは本文だけを送る", async () => {
	const h = await ready();
	await h.send("/plan");
	expect(h.client.startTurn).not.toHaveBeenCalled();
	await h.send("/plan 調査して\n計画する");
	expect(h.client.startTurn).toHaveBeenLastCalledWith(
		expect.objectContaining({
			input: [
				{ type: "text", text: "調査して\n計画する", text_elements: [] },
			],
		}),
	);
	expect(
		h.client.startTurn.mock.calls.at(-1)?.[0].collaborationMode?.mode,
	).toBe("plan");
	h.complete();
	await h.send("/goal");
	expect(h.client.startTurn).toHaveBeenCalledTimes(1);
	await h.send("継続する");
	expect(h.session.snapshot().messages.at(-1)?.text).toBe("/goal 継続する");
});

it("Defaultへの変更失敗ではPlanを維持し、設定更新中の送信を拒否する", async () => {
	const h = await ready();
	await h.setting("plan");
	const response = deferred<Record<string, never>>();
	h.client.updateCollaborationMode.mockReturnValueOnce(response.promise);
	const failed = vi.fn();
	h.session.subscribe(failed);
	const pending = h.setting("default");
	expect(h.session.snapshot().configPending).toBe(true);
	await h.send("待機中の入力");
	expect(h.client.startTurn).not.toHaveBeenCalled();
	response.reject(new Error("RPC failed"));
	await pending;
	expect(h.session.snapshot().configPending).toBe(false);
	expect(
		h.session
			.snapshot()
			.configOptions.find((item) => item.id === "collaboration_mode")
			?.currentValue,
	).toBe("plan");
	expect(failed).toHaveBeenCalledWith(
		expect.objectContaining({ type: "request/failed" }),
	);
});

it("実行中のモード変更を拒否し、新規会話はDefaultから開始する", async () => {
	const h = await ready();
	await h.send("/plan 調査する");
	await h.setting("goal");
	expect(
		h.session
			.snapshot()
			.configOptions.find((item) => item.id === "collaboration_mode")
			?.currentValue,
	).toBe("plan");
	h.complete();
	await h.send("/new");
	expect(
		h.session
			.snapshot()
			.configOptions.find((item) => item.id === "collaboration_mode")
			?.currentValue,
	).toBe("default");
});

it("計画本文を通常メッセージへ逐次表示し、完了後のdeltaを捨てる", async () => {
	const h = await ready();
	await h.send("/plan 調査する");
	const p = { threadId: "thread-1", turnId: "turn-1", itemId: "plan-1" };
	h.notify("item/started", {
		...p,
		item: { type: "plan", id: "plan-1", text: "" },
	});
	h.notify("item/plan/delta", { ...p, delta: "## 計画\n" });
	h.notify("item/plan/delta", { ...p, delta: "本文" });
	expect(h.session.snapshot().messages.at(-1)).toMatchObject({
		text: "## 計画\n本文",
		streaming: true,
	});
	h.notify("item/completed", {
		...p,
		item: { type: "plan", id: "plan-1", text: "## 計画\n確定本文" },
	});
	h.notify("item/plan/delta", { ...p, delta: "遅延" });
	expect(h.session.snapshot().messages.at(-1)).toMatchObject({
		text: "## 計画\n確定本文",
		streaming: false,
	});
	expect(h.session.snapshot().tools).toEqual([]);
});

it("Codexの補完にだけplanとgoalを追加する", () => {
	expect(
		completionItems("/", "", "", [], [], true).map((item) => item.id),
	).toEqual(expect.arrayContaining(["plan", "goal"]));
	expect(
		completionItems("/", "", "", [], [], false).map((item) => item.id),
	).not.toEqual(expect.arrayContaining(["plan", "goal"]));
});

it("Goalのフォローアップでも接頭辞を重ねずに同じターンへ送信する", async () => {
	const h = await ready();
	await h.send("/goal テストを通す");
	await h.send("/goal 既存テストも確認する");
	expect(h.client.startTurn).toHaveBeenCalledTimes(1);
	expect(h.client.steerTurn).toHaveBeenCalledWith(
		expect.objectContaining({
			input: [
				{
					type: "text",
					text: "/goal 既存テストも確認する",
					text_elements: [],
				},
			],
		}),
	);
});
