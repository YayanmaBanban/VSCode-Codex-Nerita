// 親モデルの subagent 呼出しを、子モデルの実ファイル Tool まで通して検証する。
import * as assert from "node:assert/strict";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import {
	createPiRuntime,
	type PiRuntimeSession,
	type PiRuntimeOptions,
} from "../src/extension/backends/pi/PiRuntime";
import { guardrailsFixture } from "./piGuardrailsFixture";
import type { PermissionPresentation } from "../src/shared/permission";
import { piAgentPersistenceSmoke } from "./piAgentPersistenceSmoke";

/** 独立 CLI を使わず、起動と子の変更を別々に承認する。 */
export async function piSubagentAdapterSmoke(extensionPath: string) {
	for (const storage of ["global", "workspace"] as const) {
		await adapterModeSmoke(extensionPath, storage);
	}
}

/** 保存先ごとに新しい実 SDK セッションで起動し、会話と承認の分離を確認する。 */
async function adapterModeSmoke(
	extensionPath: string,
	storage: "global" | "workspace",
) {
	const h = await guardrailsFixture();
	const controller = new AbortController();
	let parent: PiRuntimeSession | undefined;
	const approvals: PermissionPresentation[] = [];
	try {
		await mkdir(join(h.agentDir, "agents"));
		await writeFile(
			join(h.agentDir, "agents/worker.md"),
			"---\nname: worker\ndescription: fixture\ntools: read, write\nsystemPromptMode: replace\n---\nADAPTER_ROLE_FIXTURE",
		);
		const task = { agent: "worker", task: "write a fixture" };
		h.setTool("subagent", task);
		h.setChildTool("write", {
			path: "child.txt",
			content: "guarded child",
		});
		const options: PiRuntimeOptions = {
			extensionPath,
			cwd: h.cwd,
			agentDir: h.agentDir,
			signal: controller.signal,
			preferredModel: { provider: "local", model: "guard" },
			windowsSandbox: "elevated",
			executor: null,
			storage,
			authorize: (presentation, signal) => {
				approvals.push(presentation);
				return Promise.resolve(signal ?? controller.signal);
			},
		};
		parent = await createPiRuntime(options);
		const results: unknown[] = [];
		parent.subscribe((event) => {
			if (event.type === "tool_execution_end") {
				results.push(event);
			}
		});
		await parent.prompt("delegate fixture");
		const count = 1;
		assert.equal(approvals.length, count * 2, JSON.stringify(results));
		assert.equal(
			await readFile(join(h.cwd, "child.txt"), "utf8"),
			"guarded child",
		);
		assert.ok(approvals[0]!.title.includes("subagent"));
		assert.equal(
			approvals.filter((approval) =>
				approval.fields?.some(
					(field) =>
						field.id === "subagent" && field.value === "worker",
				),
			).length,
			count * 2,
		);
		assert.ok(JSON.stringify(results).includes("finished"));
		const cards = parent.agentViews!.list();
		assert.equal(cards.length, count);
		assert.ok(
			cards.every((card) => card.status === "completed"),
			JSON.stringify({ storage, results, cards }),
		);
		assert.equal(cards[0]!.status, "completed");
		const view = parent.agentViews!.read(cards[0]!.threadId);
		assert.equal(view.parentThreadId, parent.sessionId);
		assert.ok(view.messages.some((message) => message.text === "finished"));
		assert.ok(view.tools.some((tool) => tool.status === "completed"));
		const childRequest = h.requests.find((body) =>
			body.includes("ADAPTER_ROLE_FIXTURE"),
		);
		assert.ok(childRequest);
		assert.ok(!childRequest.includes('"name":"powershell"'));
		assert.ok(!childRequest.includes('"name":"subagent"'));
		const requestCount = h.requests.length;
		await piAgentPersistenceSmoke(parent, options);
		assert.equal(h.requests.length, requestCount);
	} finally {
		controller.abort();
		await parent?.close();
		await h.close();
		assert.equal(dirname(h.root), tmpdir());
		assert.ok(basename(h.root).startsWith("nerita-guard-integration-"));
		await rm(h.root, { recursive: true, force: true });
	}
}
