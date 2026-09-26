// 単一子の変換、承認前の拒否、入力の固定、取消しと回収を検証する。
import { afterEach, expect, it, vi } from "vitest";
import { createPiSubagentTool } from "../../src/extension/backends/pi/PiSubagentTool";
import type { PiSubagentDefinition } from "../../src/extension/backends/pi/PiSubagentDefinitions";
import type { PiChildRuntimes } from "../../src/extension/backends/pi/PiChildRuntimes";
import type { PiRuntimeSession } from "../../src/extension/backends/pi/PiRuntime";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { sandboxFixture } from "./sandboxFixtures";
import { pending } from "./piHarness";
import { guardrailRegistry } from "../../src/extension/security/GuardrailRegistry";
import { defaultGuardrails } from "../../src/shared/guardrails/config";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	guardrailRegistry.dispose();
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/** SDK の子は差し替え、共通ガードと入力スキーマは実装を使う。 */
async function fixture(overrides: Partial<PiSubagentDefinition> = {}) {
	const files = await sandboxFixture();
	cleanups.push(() => files.cleanup());
	const abort = new AbortController();
	const authorize = vi.fn(() => Promise.resolve(abort.signal));
	const session = {
		subscribe: vi.fn(() => vi.fn()),
		prompt: vi.fn(() => Promise.resolve()),
		close: vi.fn(() => Promise.resolve()),
	} as unknown as PiRuntimeSession;
	const open = vi.fn(() => Promise.resolve(session));
	const definitions: PiSubagentDefinition[] = [
		{
			name: "reviewer",
			description: "fixture",
			prompt: "review-only",
			source: "user",
			tools: ["read", "ls", "grep", "find"],
			...overrides,
		},
	];
	const tool = createPiSubagentTool(
		definitions,
		{ open } as unknown as PiChildRuntimes,
		files.policy,
		files.cwd,
		authorize,
		abort.signal,
	);
	const rawContext: unknown = {
		cwd: files.cwd,
		model: { provider: "local", id: "guard" },
	};
	const context = rawContext as Parameters<ToolDefinition["execute"]>[4];
	const run = (params: unknown) =>
		tool.execute("fixture", params, undefined, undefined, context);
	return { ...files, abort, authorize, session, open, definitions, run };
}

it("readonly定義を権限と公開Toolへ変換し、完了した子を回収する", async () => {
	const h = await fixture();
	await h.run({ agent: "reviewer", task: "review" });
	expect(h.authorize).toHaveBeenCalledOnce();
	expect(h.open).toHaveBeenCalledWith(
		expect.objectContaining({
			role: { writableRoots: [], shell: false },
			allowedTools: ["read", "ls"],
			systemPrompt: "review-only",
			preferredModel: { provider: "local", model: "guard" },
			approvalContext: { agent: "reviewer", task: "review" },
		}),
	);
	expect(h.session.prompt).toHaveBeenCalledWith("review");
	expect(h.session.close).toHaveBeenCalledOnce();
});
it.each([
	{ tasks: [{ agent: "reviewer", task: "x" }] },
	{ chain: [{ agent: "reviewer", task: "x" }] },
	{ agent: "missing", task: "x" },
	{ agent: "reviewer", task: "x", extra: true },
	{ agent: "reviewer", task: "x", async: true },
	{ agent: "reviewer", task: "x", context: "fork" },
	{
		workflowScript:
			"return runs.run('x', { agent: 'reviewer', task: 'x' });",
	},
])("未対応入力で子を起動しない: %j", async (params) => {
	const h = await fixture();
	await expect(h.run(params)).rejects.toThrow();
	expect(h.authorize).not.toHaveBeenCalled();
	expect(h.open).not.toHaveBeenCalled();
});

it("pi-subagents の別名と明示モデル・プロンプト置換を子へ渡す", async () => {
	const h = await fixture({
		aliases: ["checker"],
		systemPromptMode: "replace",
	});
	await h.run({
		agent: "checker",
		task: "review",
		model: "local/custom:high",
		context: "fresh",
		async: false,
	});
	expect(h.open).toHaveBeenCalledWith(
		expect.objectContaining({
			systemPromptMode: "replace",
			preferredModel: {
				provider: "local",
				model: "custom",
				reasoning: "high",
			},
		}),
	);
});

it("外部runner定義は通常の子へ読み替えず、承認前に拒否する", async () => {
	const h = await fixture({ unavailableReason: "外部runnerは未対応" });
	await expect(h.run({ agent: "reviewer", task: "x" })).rejects.toThrow(
		"未対応",
	);
	expect(h.authorize).not.toHaveBeenCalled();
	expect(h.open).not.toHaveBeenCalled();
});
it("workspace外cwdを承認前に拒否する", async () => {
	const h = await fixture();
	await expect(
		h.run({ agent: "reviewer", task: "x", cwd: h.outside }),
	).rejects.toThrow("拒否");
	expect(h.authorize).not.toHaveBeenCalled();
	expect(h.open).not.toHaveBeenCalled();
});
it("承認拒否では子を起動しない", async () => {
	const h = await fixture();
	h.authorize.mockRejectedValueOnce(new Error("declined"));
	await expect(h.run({ agent: "reviewer", task: "x" })).rejects.toThrow(
		"declined",
	);
	expect(h.open).not.toHaveBeenCalled();
});
it.each(["stop", "settings"])(
	"起動承認中の%sは、遅れた許可でも子を起動しない",
	async (action) => {
		const h = await fixture();
		const gate = pending<AbortSignal>();
		h.authorize.mockReturnValue(gate.promise);
		const running = h.run({ agent: "reviewer", task: "x" });
		const rejected = expect(running).rejects.toThrow();
		await vi.waitFor(() => expect(h.authorize).toHaveBeenCalled());
		if (action === "stop") {
			h.abort.abort();
		} else {
			guardrailRegistry.apply(h.cwd, defaultGuardrails());
		}
		gate.resolve(new AbortController().signal);
		await rejected;
		expect(h.open).not.toHaveBeenCalled();
	},
);
it("承認待ちに入力と元の定義を変更しても子の内容は変わらない", async () => {
	const h = await fixture();
	const gate = pending<AbortSignal>();
	h.authorize.mockReturnValue(gate.promise);
	const input = { agent: "reviewer", task: "original" };
	const running = h.run(input);
	await vi.waitFor(() => expect(h.authorize).toHaveBeenCalled());
	input.task = "changed";
	h.definitions[0]!.prompt = "changed";
	gate.resolve(h.abort.signal);
	await running;
	expect(h.session.prompt).toHaveBeenCalledWith("original");
	expect(h.open).toHaveBeenCalledWith(
		expect.objectContaining({ systemPrompt: "review-only" }),
	);
});
it("子の失敗でも回収する", async () => {
	const h = await fixture();
	vi.mocked(h.session.prompt).mockRejectedValue(new Error("failed"));
	await expect(h.run({ agent: "reviewer", task: "x" })).rejects.toThrow(
		"failed",
	);
	expect(h.session.close).toHaveBeenCalledOnce();
});

it("子の実行中も親と設定世代の取消し信号を引き継ぐ", async () => {
	const h = await fixture();
	const gate = pending<void>();
	vi.mocked(h.session.prompt).mockReturnValue(gate.promise);
	const running = h.run({ agent: "reviewer", task: "x" });
	const rejected = expect(running).rejects.toThrow();
	await vi.waitFor(() => expect(h.open).toHaveBeenCalled());
	const options = vi.mocked(h.open).mock.calls[0];
	// open の引数は製品の子起動契約として取得する。
	const passed = (
		options as unknown as [Parameters<PiChildRuntimes["open"]>[0]]
	)[0];
	guardrailRegistry.apply(h.cwd, defaultGuardrails());
	expect(passed.signal?.aborted).toBe(true);
	gate.resolve();
	await rejected;
	expect(h.session.close).toHaveBeenCalledOnce();
});
