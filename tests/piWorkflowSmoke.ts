// 導入済みの Worker と実 SDK を通して、TOML・保持会話・Fork・保存を確認する。
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { guardrailsFixture } from "./piGuardrailsFixture";
import {
	createPiRuntime,
	type PiRuntimeSession,
} from "./piTrustedRuntime";
import { piAgentPersistenceSmoke } from "./piAgentPersistenceSmoke";
import { piWorkflowEditorSmoke } from "./piWorkflowEditorSmoke";

/** グローバル設定と課金モデルを変更せず、専用ディレクトリにだけ書き込む。 */
export async function piWorkflowSmoke(
	extensionPath: string,
	packagePath: string,
) {
	const h = await guardrailsFixture();
	const abort = new AbortController();
	let parent: PiRuntimeSession | undefined;
	try {
		await mkdir(join(h.agentDir, "agents"));
		for (const agent of ["worker", "reviewer"]) {
			await writeFile(
				join(h.agentDir, "agents", `${agent}.md`),
				`---\nname: ${agent}\ndescription: fixture\ntools: read, write\n---\nWORKFLOW_CHILD`,
			);
		}
		await writeFile(
			join(h.agentDir, "settings.json"),
			JSON.stringify({ packages: [packagePath] }),
		);
		await mkdir(join(h.cwd, ".pi/workflows"), { recursive: true });
		await writeFile(
			join(h.cwd, ".pi/workflows/test.toml"),
			await readFile(
				join(
					extensionPath,
					"tests/fixtures/workflows/implementation-review.toml",
				),
				"utf8",
			),
		);
		h.setTool("subagent_workflow", { action: "run", file: "test.toml" });
		h.setChildTool("write", {
			path: "child.txt",
			content: "workflow child",
		});
		const approvals: string[] = [];
		const options = {
			extensionPath,
			cwd: h.cwd,
			agentDir: h.agentDir,
			signal: abort.signal,
			preferredModel: { provider: "local", model: "guard" },
			windowsSandbox: "elevated" as const,
			executor: null,
			storage: "workspace" as const,
			authorize: (
				presentation: { title: string },
				signal?: AbortSignal,
			) => {
				approvals.push(presentation.title);
				return Promise.resolve(signal ?? abort.signal);
			},
		};
		h.setTool("subagent_workflow", {
			action: "validate",
			file: "test.toml",
		});
		parent = await createPiRuntime({ ...options, ephemeral: true });
		const validation: unknown[] = [];
		parent.subscribe((event) => {
			if (event.type === "tool_execution_end") {
				validation.push(event);
			}
		});
		await parent.prompt("validate workflow fixture");
		assert.equal(parent.jobs!.list().length, 0);
		assert.ok(
			JSON.stringify(validation).includes("runs.run"),
			JSON.stringify(validation),
		);
		await parent.close();
		h.setTool("subagent_workflow", { action: "run", file: "test.toml" });
		parent = await createPiRuntime(options);
		let opened = 0;
		const open = parent.children.open.bind(parent.children);
		parent.children.open = async (settings) => {
			opened++;
			return open(settings);
		};
		await parent.prompt("execute workflow fixture");
		assert.equal(opened, 3, JSON.stringify(parent.jobs!.list()));
		assert.equal(parent.jobs!.list().length, 5);
		assert.ok(
			parent.jobs!.list().every((job) => job.status === "completed"),
			JSON.stringify(parent.jobs!.list()),
		);
		assert.equal(
			await readFile(join(h.cwd, "child.txt"), "utf8"),
			"workflow child",
		);
		assert.ok(approvals.length >= 4);
		assert.ok(
			h.requests.some(
				(body) =>
					body.includes("実装の経緯") &&
					body.includes("実装を進めて"),
			),
		);
		assert.ok(
			h.requests.some(
				(body) =>
					body.includes("レビュー結果を反映") &&
					body.includes("実装を進めて"),
			),
		);
		await piAgentPersistenceSmoke(parent, options);
		await piWorkflowEditorSmoke(
			options,
			await readFile(join(h.cwd, ".pi/workflows/test.toml"), "utf8"),
		);
	} finally {
		abort.abort();
		await parent?.close();
		await h.close();
		assert.equal(dirname(h.root), tmpdir());
		assert.ok(basename(h.root).startsWith("nerita-guard-integration-"));
		await rm(h.root, { recursive: true, force: true });
	}
}
