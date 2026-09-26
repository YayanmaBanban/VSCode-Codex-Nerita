// 保持した SDK の再利用、完了時の Fork、取消し後の回収を検証する。
import { expect, it, vi } from "vitest";
import { PiWorkflowChildren } from "../../src/extension/backends/pi/workflows/PiWorkflowChildren";
import { parseWorkflow } from "../../src/shared/workflows/definition";
import { PiAgentViews } from "../../src/extension/backends/pi/PiAgentViews";
import { PiJobs } from "../../src/extension/backends/pi/PiJobs";
import type {
	PiChildRuntimes,
	PiChildOptions,
} from "../../src/extension/backends/pi/PiChildRuntimes";
import type {
	PiRuntimeSession,
	PiEvent,
} from "../../src/extension/backends/pi/PiRuntime";
import type { PiForkMessage } from "../../src/extension/backends/pi/PiForkContext";
import { sandboxFixture } from "./sandboxFixtures";
import { assistant } from "./piHarness";
import { readFile } from "node:fs/promises";

it("resume は同じ SDK を使い、fork は完了時の会話を独立してコピーする", async () => {
	const files = await sandboxFixture();
	const sessions: PiRuntimeSession[] = [];
	const options: PiChildOptions[] = [];
	const open = vi.fn((input: PiChildOptions) => {
		options.push(input);
		const messages: PiForkMessage[] = [...(input.initialMessages ?? [])];
		const listeners = new Set<(event: PiEvent) => void>();
		const raw: unknown = {
			accessPolicy: files.policy,
			contextSource: { buildSessionContext: () => ({ messages }) },
			subscribe: (listener: (event: PiEvent) => void) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			prompt: vi.fn((task: string) => {
				messages.push({ role: "user", content: task, timestamp: 1 });
				const message = assistant(`result ${sessions.length}`);
				messages.push(message);
				for (const listener of listeners) {
					listener({ type: "message_end", message });
				}
				return Promise.resolve();
			}),
			abort: vi.fn(() => Promise.resolve()),
			close: vi.fn(() => Promise.resolve()),
		};
		const session = raw as PiRuntimeSession;
		sessions.push(session);
		return Promise.resolve(session);
	});
	const views = new PiAgentViews();
	const jobs = new PiJobs(views);
	const abort = new AbortController();
	const definition = parseWorkflow(
		await readFile(
			"tests/fixtures/workflows/implementation-review.toml",
			"utf8",
		),
	);
	const agents = ["worker", "reviewer"].map((name) => ({
		name,
		description: "fixture",
		prompt: "fixture",
		source: "user" as const,
	}));
	const group = new PiWorkflowChildren(
		definition,
		agents,
		{ provider: "local", id: "test" },
		{ open } as unknown as PiChildRuntimes,
		views,
		jobs,
		files.policy,
		files.cwd,
		(_presentation, signal) => Promise.resolve(signal!),
		"workflow",
		abort.signal,
	);
	try {
		const first = await group.launch(
			"implement",
			{ agent: "worker", task: definition.steps[0]!.task },
			abort.signal,
		);
		const review = await group.launch(
			"review",
			{
				agent: "reviewer",
				neritaFork: first.runId,
				task: `実装の経緯を踏まえて確認してください。${first.output}`,
			},
			abort.signal,
		);
		const checks = await group.launch(
			"tests",
			{
				agent: "reviewer",
				task: `テスト観点で確認してください。${first.output}`,
			},
			abort.signal,
		);
		await group.launch(
			"fix",
			{
				resume: first.runId,
				task: `レビュー結果を反映してください。${review.output} / ${checks.output}`,
			},
			abort.signal,
		);
		expect(open).toHaveBeenCalledTimes(3);
		expect(sessions[0]!.prompt).toHaveBeenCalledTimes(2);
		expect(options[1]!.initialMessages).toHaveLength(2);
		expect(
			options[1]!.initialMessages?.some((message) =>
				JSON.stringify(message).includes("レビュー結果を反映"),
			),
		).toBe(false);
		await expect(
			group.launch(
				"fix",
				{ resume: first.runId, task: "extra" },
				abort.signal,
			),
		).rejects.toThrow();
	} finally {
		await group.close();
		for (const session of sessions) {
			expect(session.close).toHaveBeenCalledOnce();
		}
		await files.cleanup();
	}
});
