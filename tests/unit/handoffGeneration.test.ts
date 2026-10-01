// バックエンドへのモデル・推論指定と、生成終了時の接続回収を確認する。
import { expect, it, vi } from "vitest";
import { generateCodexHandoff } from "../../apps/vscode-nerita/src/extension/backends/codex/context/handoffGeneration";
import { generatePiHandoff } from "../../apps/vscode-nerita/src/extension/backends/pi/PiHandoffGeneration";
import type { HandoffRequest } from "../../apps/vscode-nerita/src/extension/session/HandoffContext";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { codexHarness } from "./codexHarness";
import { assistant } from "./piHarness";

/** 生成処理へ渡す設定を固定する。 */
function request(): HandoffRequest {
	return {
		model: "chosen",
		effort: "high",
		timeoutMs: 1234,
		systemPrompt: "summarize",
		prompt: "source",
		signal: new AbortController().signal,
	};
}
it("Codex は一時スレッドへモデル・推論・プロンプトを渡し完了後に接続を閉じる", async () => {
	const h = codexHarness();
	const result = generateCodexHandoff(h.factory, "workspace", request());
	await vi.waitFor(() => expect(h.client.startTurn).toHaveBeenCalled());
	expect(h.client.startThread).toHaveBeenCalledWith(
		expect.objectContaining({
			model: "chosen",
			ephemeral: true,
			baseInstructions: "summarize",
		}),
	);
	expect(h.client.startTurn).toHaveBeenCalledWith(
		expect.objectContaining({
			model: "chosen",
			effort: "high",
			input: [{ type: "text", text: "source", text_elements: [] }],
		}),
	);
	h.notify("item/completed", {
		threadId: "other",
		item: { type: "agentMessage", id: "a", text: "unrelated" },
	});
	h.notify("item/completed", {
		threadId: "thread-1",
		item: { type: "agentMessage", id: "a", text: "summary" },
	});
	h.notify("turn/completed", {
		threadId: "thread-1",
		turn: { status: "completed" },
	});
	await expect(result).resolves.toBe("summary");
	expect(h.client.dispose).toHaveBeenCalledOnce();
});
it("Codex の中止でも専用接続を閉じる", async () => {
	const h = codexHarness();
	const abort = new AbortController();
	const result = generateCodexHandoff(h.factory, "workspace", {
		...request(),
		signal: abort.signal,
	});
	const rejected = expect(result).rejects.toThrow("cancelled");
	await vi.waitFor(() => expect(h.client.startTurn).toHaveBeenCalled());
	abort.abort();
	await rejected;
	expect(h.client.dispose).toHaveBeenCalledOnce();
});
it("Codex の失敗ターンを要約として返さない", async () => {
	const h = codexHarness();
	const result = generateCodexHandoff(h.factory, "workspace", request());
	const rejected = expect(result).rejects.toThrow("failed");
	await vi.waitFor(() => expect(h.client.startTurn).toHaveBeenCalled());
	h.notify("turn/completed", {
		threadId: "thread-1",
		turn: { status: "failed" },
	});
	await rejected;
	expect(h.client.dispose).toHaveBeenCalledOnce();
});
/** Pi のモデル要求境界だけを差し替える。 */
function models() {
	const model = {
		provider: "provider",
		id: "chosen",
		api: "openai-responses",
	};
	const completeSimple = vi.fn().mockResolvedValue(assistant("summary"));
	return {
		model,
		completeSimple,
		runtime: {
			getAvailableSnapshot: () => [model],
			completeSimple,
		} as unknown as ModelRuntime,
	};
}
it("Pi は選択モデルの生成 API に推論とプロンプトを渡す", async () => {
	const m = models();
	await expect(
		generatePiHandoff(
			m.runtime,
			{ ...request(), model: "provider/chosen" },
			["high"],
		),
	).resolves.toBe("summary");
	expect(m.completeSimple).toHaveBeenCalledWith(
		m.model,
		expect.objectContaining({
			systemPrompt: "summarize",
			messages: [
				expect.objectContaining({
					role: "user",
					content: [{ type: "text", text: "source" }],
				}),
			],
		}),
		expect.objectContaining({
			reasoning: "high",
			signal: expect.any(AbortSignal) as unknown,
		}),
	);
});
it("子起動機構のないハンドオフでは Ultra を要求へ送信しない", async () => {
	const m = models();
	await expect(
		generatePiHandoff(
			m.runtime,
			{ ...request(), model: "provider/chosen", effort: "ultra" },
			["ultra"],
		),
	).rejects.toThrow("Ultra");
	expect(m.completeSimple).not.toHaveBeenCalled();
});
it("Pi の未対応推論指定は生成前に拒否する", async () => {
	const m = models();
	await expect(
		generatePiHandoff(
			m.runtime,
			{ ...request(), model: "provider/chosen" },
			["low"],
		),
	).rejects.toThrow("推論");
	expect(m.completeSimple).not.toHaveBeenCalled();
});
