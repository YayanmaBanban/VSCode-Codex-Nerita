// 導入済みワークフローエンジンを実 SDK の子へ接続し、結果と副作用を確認する。
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { piFixture, send, permission, finished, until } from "../support/pi";
import { restoredState } from "../support/restoredState";

for (const outcome of ["accept", "stop", "restricted"]) {
	void test(`導入済みワークフローの結果・権限・停止を履歴まで確認する（${outcome}）`, async (t) => {
		const f = await piFixture(t);
		if (outcome === "restricted") {
			f.options.role = { writableRoots: [] };
		}
		assert.ok(process.env.NERITA_EXTERNAL_AGENT_DIR);
		const installed = join(
			process.env.NERITA_EXTERNAL_AGENT_DIR,
			"npm/node_modules/pi-subagents",
		);
		const manifest = JSON.parse(
			await readFile(join(installed, "package.json"), "utf8"),
		) as { name: string };
		assert.equal(manifest.name, "pi-subagents");
		await writeFile(
			join(f.agentDir, "settings.json"),
			JSON.stringify({ packages: [installed] }),
		);
		await mkdir(join(f.agentDir, "agents"));
		await writeFile(
			join(f.agentDir, "agents/acceptance-worker.md"),
			"---\nname: acceptance-worker\ndescription: 検証の作業担当\ntools: read, write\n---\n指示された作業を行う。\n",
		);
		await mkdir(join(f.cwd, ".pi/workflows"), { recursive: true });
		await writeFile(
			join(f.cwd, ".pi/workflows/acceptance.toml"),
			`version = 1
name = "受入"
outputs = ["second"]
[[steps]]
id = "first"
agent = "acceptance-worker"
task = "最初の工程"
[[steps]]
id = "second"
agent = "acceptance-worker"
depends_on = ["first"]
task = "前工程の結果: {{ first.output }}"
`,
		);
		f.model.replies.push(
			{
				name: "subagent_workflow",
				arguments: { action: "run", file: "acceptance.toml" },
			},
			"引き継ぐ結果",
			{
				name: "write",
				arguments: { path: "workflow.txt", content: "workflow-result" },
			},
			"後工程完了",
			"親が受領",
		);
		const controller = f.controller();
		await controller.connect();
		assert.equal(
			controller.snapshot().connection,
			"ready",
			JSON.stringify(controller.snapshot()),
		);
		await send(controller, "ワークフローを実行");
		await permission(controller, "accept");
		await permission(controller, "accept");
		if (outcome === "stop") {
			await until(() => controller.snapshot().permissions.length === 1);
			const pending = controller.snapshot();
			await controller.receive({
				type: "prompt/cancel",
				requestId: "stop",
				sessionId: pending.sessionId,
				runId: pending.runId,
			});
			await controller.receive({
				type: "permission/respond",
				requestId: "late",
				sessionId: pending.sessionId,
				runId: pending.runId,
				permissionId: pending.permissions[0]!.id,
				optionId: "accept",
			});
		} else if (outcome === "accept") {
			await permission(controller, "accept");
		}
		const state = await finished(controller);
		assert.equal(
			state.tools[0]?.status,
			{ accept: "completed", stop: "cancelled", restricted: "failed" }[
				outcome
			],
			JSON.stringify(state),
		);
		if (outcome !== "accept") {
			await assert.rejects(readFile(join(f.cwd, "workflow.txt")), {
				code: "ENOENT",
			});
		} else {
			assert.equal(
				await readFile(join(f.cwd, "workflow.txt"), "utf8"),
				"workflow-result",
			);
			assert.ok(f.model.requests[4]!.includes("後工程完了"));
		}
		assert.ok(f.model.requests[2]!.includes("前工程の結果: 引き継ぐ結果"));
		assert.equal(state.agents.length, 3);
		await controller.dispose();
		const restored = await restoredState(f, state.sessionId!);
		assert.deepEqual(
			restored.agents.map(({ threadId, status }) => ({
				threadId,
				status,
			})),
			state.agents.map(({ threadId, status }) => ({ threadId, status })),
		);
		assert.equal(f.model.requests.length, outcome === "stop" ? 3 : 5);
	});
}
