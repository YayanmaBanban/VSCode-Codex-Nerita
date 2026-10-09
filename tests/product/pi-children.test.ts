// SDK 本体で動く子へ文脈と制限を渡し、子の副作用・停止・保存した親子関係を確認する。

import { type TestContext, test } from "node:test";

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { piFixture, send, finished, permission, until } from "../support/pi";
import { restoredState } from "../support/restoredState";

for (const outcome of ["accept", "stop", "child-stop", "restricted"]) {
	void test(`子の起動と書込みを個別承認し、親の制限と停止を継承する（${outcome}）`, (t) =>
		verifyPiChildApproval(t, outcome));
}

/** 子の承認・停止・制限を親から継承し、復元後も子の結果を維持する。 */
async function verifyPiChildApproval(t: TestContext, outcome: string) {
	const f = await piFixture(t);
	await mkdir(join(f.agentDir, "agents"));
	await writeFile(
		join(f.agentDir, "agents/worker.md"),
		`---\nname: worker\ndescription: 作業担当\ntools: read, write\n---\n指定された作業だけを行う。\n`,
	);
	if (outcome === "restricted") {
		f.options.role = { writableRoots: [] };
	}
	const controller = f.controller();
	await controller.connect();
	f.model.replies.push("親の回答");
	await send(controller, "子に引き継ぐ文脈");
	await finished(controller);
	queueChildReplies(f);
	await send(controller, "委譲する");
	await permission(controller, "accept");
	await until(
		() => f.model.requests.length >= 3,
		() => controller.snapshot(),
	);
	assert.ok(f.model.requests[2]!.includes("子に引き継ぐ文脈"));
	assert.ok(f.model.requests[2]!.includes("子の作業"));
	if (outcome === "accept") {
		await permission(controller, "accept");
	} else if (outcome === "stop" || outcome === "child-stop") {
		await until(() => controller.snapshot().permissions.length === 1);
		const pending = controller.snapshot();
		await controller.receive({
			...(outcome === "child-stop"
				? { type: "agent/stop", threadId: pending.agents[0]!.threadId }
				: { type: "prompt/cancel", runId: pending.runId }),
			requestId: "stop",
			sessionId: pending.sessionId,
		});
		await controller.receive({
			type: "permission/respond",
			requestId: "late",
			sessionId: pending.sessionId,
			runId: pending.runId,
			permissionId: pending.permissions[0]!.id,
			optionId: "accept",
		});
	}
	const state = await finished(controller);
	assert.equal(state.agents.length, 1, JSON.stringify(state));
	const child = state.agents[0]!;
	assert.equal(child.parentThreadId, state.sessionId);
	assert.equal(
		child.status,
		{
			accept: "completed",
			stop: "interrupted",
			"child-stop": "interrupted",
			restricted: "errored",
		}[outcome],
	);
	if (outcome === "accept") {
		assert.equal(
			await readFile(join(f.cwd, "child.txt"), "utf8"),
			"child-result",
		);
		assert.ok(f.model.requests.at(-1)!.includes("子の回答"));
	} else {
		await assert.rejects(readFile(join(f.cwd, "child.txt")), {
			code: "ENOENT",
		});
	}
	await controller.dispose();
	const restored = await restoredState(f, state.sessionId!);
	assert.equal(restored.agents.length, 1);
	assert.equal(restored.agents[0]!.threadId, child.threadId);
	assert.equal(restored.agents[0]!.status, child.status);
	assert.equal(
		f.model.requests.length,
		{ stop: 3, "child-stop": 4, accept: 5, restricted: 5 }[outcome],
	);
	assert.equal(state.run, outcome === "stop" ? "cancelled" : "completed");
}

/** 親の委譲、子の書込み、親への結果通知を順番に返す。 */
function queueChildReplies(f: Awaited<ReturnType<typeof piFixture>>) {
	f.model.replies.push(
		{
			name: "subagent",
			arguments: {
				agent: "worker",
				task: "子の作業",
				context: "fork",
			},
		},
		{
			name: "write",
			arguments: { path: "child.txt", content: "child-result" },
		},
		"子の回答",
		"親が結果を受領",
	);
}
