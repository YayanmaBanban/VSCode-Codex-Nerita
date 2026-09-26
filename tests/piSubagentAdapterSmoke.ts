// 親モデルの subagent 呼出しを、子モデルの実ファイル Tool まで通して検証する。
import * as assert from "node:assert/strict";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import {
	createPiRuntime,
	type PiRuntimeSession,
	type PiRuntimeOptions,
} from "./piTrustedRuntime";
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
	const background = storage === "workspace";
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	try {
		await mkdir(join(h.agentDir, "agents"));
		await writeFile(
			join(h.agentDir, "agents/worker.md"),
			"---\nname: worker\ndescription: fixture\ntools: read, write\nsystemPromptMode: replace\n---\nADAPTER_ROLE_FIXTURE",
		);
		const task = {
			agent: "worker",
			task: "write a fixture",
			async: background,
			context: background ? "fork" : "fresh",
		};
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
			authorize: async (presentation, signal) => {
				approvals.push(presentation);
				if (background) {
					await gate;
				}
				return signal ?? controller.signal;
			},
		};
		parent = await createPiRuntime(options);
		const results: unknown[] = [];
		parent.subscribe((event) => {
			if (event.type === "tool_execution_end") {
				results.push(event);
			}
		});
		await parent.prompt("PARENT_CONTEXT_FIXTURE delegate fixture");
		if (background) {
			assert.ok(JSON.stringify(results).includes("jobId"));
			assert.equal(parent.jobs!.list()[0]!.status, "approval");
		}
		release();
		await waitForJobs(parent);
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
		assert.ok(JSON.stringify(parent.jobs!.list()).includes("finished"));
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
		assert.equal(
			childRequest.includes("PARENT_CONTEXT_FIXTURE"),
			background,
		);
		assert.ok(!childRequest.includes('"name":"powershell"'));
		assert.ok(!childRequest.includes('"name":"subagent"'));
		const requestCount = h.requests.length;
		await piAgentPersistenceSmoke(parent, options);
		assert.equal(h.requests.length, requestCount);
	} finally {
		release();
		controller.abort();
		await parent?.close();
		await h.close();
		assert.equal(dirname(h.root), tmpdir());
		assert.ok(basename(h.root).startsWith("nerita-guard-integration-"));
		await rm(h.root, { recursive: true, force: true });
	}
}

/** 背景実行は親の応答とは別に完了を待ち、停止不能なら検証を失敗させる。 */
async function waitForJobs(parent: PiRuntimeSession) {
	const deadline = Date.now() + 5000;
	while (
		parent
			.jobs!.list()
			.some((job) =>
				["queued", "running", "approval"].includes(job.status),
			)
	) {
		assert.ok(Date.now() < deadline, "背景ジョブが終了しませんでした。");
		await delay(10);
	}
}
