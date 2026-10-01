// 実 SDK の子会話で継続と Fork を区別し、結果と親子関係を保存から復元する。
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parseWorkflow } from "@nerita/shared/workflows/definition";
import { PiWorkflowChildren } from "../../apps/vscode-nerita/src/extension/backends/pi/workflows/PiWorkflowChildren";
import { piDelegation } from "../fixtures/piDelegation";
import { verifyPiAgentPersistence } from "../fixtures/piAgentPersistence";

it("ワークフローの実会話を継続・Forkし、完了結果を別接続へ復元する", async () => {
	const h = await piDelegation();
	let group: PiWorkflowChildren | undefined;
	try {
		await writeFile(join(h.cwd, "input.txt"), "workflow fixture");
		h.setTool("read", { path: "input.txt" });
		const parent = await h.open();
		await parent.prompt("prepare workflow");
		h.setChildTool("write", {
			path: "workflow.txt",
			content: "workflow result",
		});
		const definition = parseWorkflow(
			await readFile(
				"tests/fixtures/workflows/implementation-review.toml",
				"utf8",
			),
		);
		group = new PiWorkflowChildren(
			definition,
			["worker", "reviewer"].map((name) => ({
				name,
				description: "fixture",
				prompt: `WORKFLOW_${name}`,
				source: "user" as const,
				tools: ["read", "write"],
			})),
			{ provider: "local", id: "guard" },
			parent.children,
			parent.agentViews!,
			parent.jobs!,
			parent.accessPolicy,
			h.cwd,
			h.options.authorize!,
			parent.sessionId,
			h.abort.signal,
		);
		const first = await group.launch(
			"implement",
			{ agent: "worker", task: definition.steps[0]!.task },
			h.abort.signal,
		);
		expect(first.output).toBe("finished");
		const review = await group.launch(
			"review",
			{
				agent: "reviewer",
				neritaFork: first.runId,
				task: `実装の経緯を踏まえて確認してください。${first.output}`,
			},
			h.abort.signal,
		);
		const checks = await group.launch(
			"tests",
			{
				agent: "reviewer",
				task: `テスト観点で確認してください。${first.output}`,
			},
			h.abort.signal,
		);
		await group.launch(
			"fix",
			{
				resume: first.runId,
				task: `レビュー結果を反映してください。${review.output} / ${checks.output}`,
			},
			h.abort.signal,
		);
		expect(await readFile(join(h.cwd, "workflow.txt"), "utf8")).toBe(
			"workflow result",
		);
		const requests = h.requests.map(
			(body) =>
				JSON.parse(body) as {
					messages: { role: string; content: unknown }[];
				},
		);
		const users = requests.map((request) =>
			request.messages
				.filter((message) => message.role === "user")
				.map((message) => JSON.stringify(message.content))
				.join("\n"),
		);
		expect(
			users.some(
				(text) =>
					text.includes("実装の経緯") &&
					text.includes("実装を進めて"),
			),
		).toBe(true);
		expect(
			users.some(
				(text) =>
					text.includes("レビュー結果を反映") &&
					text.includes("実装を進めて") &&
					!text.includes("実装の経緯"),
			),
		).toBe(true);
		const independent = users.filter((text) => text.includes("テスト観点"));
		expect(independent.length).toBeGreaterThan(0);
		expect(
			independent.every((text) => !text.includes("実装を進めて")),
		).toBe(true);
		expect(parent.jobs!.list()).toHaveLength(4);
		expect(parent.jobs!.list().map((job) => job.status)).toEqual([
			"completed",
			"completed",
			"completed",
			"completed",
		]);
		const requestsBeforeDuplicate = h.requests.length;
		await expect(
			group.launch(
				"fix",
				{ resume: first.runId, task: "extra" },
				h.abort.signal,
			),
		).rejects.toThrow("不正");
		expect(h.requests).toHaveLength(requestsBeforeDuplicate);
		await group.close();
		await verifyPiAgentPersistence(parent, h.options);
		expect(h.requests).toHaveLength(requestsBeforeDuplicate);
	} finally {
		await group?.close();
		await h.cleanup();
	}
});
