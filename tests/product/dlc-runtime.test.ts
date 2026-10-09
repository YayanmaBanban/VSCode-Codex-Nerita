// モデルの HTTP 境界だけを制御し、Pi の実ツール・承認・ソース収集から DLC の結果を確認する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DlcController } from "@nerita/dlc/controller";
import { type IntentState } from "@nerita/dlc/state";
import { type ExecutionRequest } from "@nerita/dlc/runtime";
import { validStateField } from "@nerita/shared/stateFieldValidation";

import { plannedIntent } from "../support/dlc";
import { piFixture, until } from "../support/pi";
import { codexFixture } from "../support/codex";
import { dlcRuntimeFixture } from "../support/dlcRuntime";
import { collectSourceSnapshot } from "../../apps/vscode-nerita/src/extension/dlc/SourceSnapshot";

const execute = promisify(execFile);
void test("DLC の管理 JSON と staged 更新は実装成果に含めず、Markdown は別の成果物として収集する", async (t) => {
	const f = await piFixture(t);
	await prepareRepository(f.cwd);
	const signal = new AbortController().signal;
	const before = await collectSourceSnapshot(f.cwd, signal);
	const directory = ".nerita/dlc/spaces/default/knowledge";
	await mkdir(join(f.cwd, directory), { recursive: true });
	await writeFile(
		join(f.cwd, ".nerita/dlc/workspace.json"),
		'{"revision":123}',
	);
	await execute("git", ["-C", f.cwd, "add", ".nerita/dlc/workspace.json"], {
		windowsHide: true,
	});
	const after = await collectSourceSnapshot(f.cwd, signal);
	assert.deepEqual(after, before);
	await writeFile(join(f.cwd, directory, "rule.md"), "参考資料");
	const knowledge = await collectSourceSnapshot(f.cwd, signal);
	assert.deepEqual(knowledge.files, before.files);
	assert.deepEqual(
		knowledge.artifacts?.map((item) => item.path),
		[`${directory}/rule.md`],
	);
	assert.notEqual(knowledge.id, before.id);
});
async function prepareRepository(cwd: string) {
	await writeFile(join(cwd, "hello.txt"), "before\n");
	await execute("git", ["init", cwd], { windowsHide: true });
	await execute("git", ["-C", cwd, "add", "hello.txt"], {
		windowsHide: true,
	});
	await execute(
		"git",
		[
			"-C",
			cwd,
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.test",
			"commit",
			"-m",
			"fixture",
		],
		{ windowsHide: true },
	);
}

void test("実際の Pi 書込みと承認を経て、構造化結果とは別に根拠を保存する", async (t) => {
	const f = await piFixture(t);
	await prepareRepository(f.cwd);
	f.model.replies.push(
		{ name: "write", arguments: { path: "hello.txt", content: "after\n" } },
		JSON.stringify({
			attemptId: "attempt",
			workItemId: "00000000-0000-4000-8000-000000000023:task:1",
			outcome: "implemented",
			summary: "挨拶を更新した",
			changedPaths: ["hello.txt"],
		}),
	);
	let approvals = 0;
	const { runtime, repository } = await dlcRuntimeFixture(
		t,
		f.cwd,
		() => f.controller(),
		() => {
			approvals += 1;
		},
	);
	let saved: IntentState | undefined;
	const controller = await DlcController.open(
		plannedIntent(),
		runtime,
		{
			save: (state) => {
				saved = state;
				return repository.save(state, state.revision - 1);
			},
		},
		() => "attempt",
	);
	const result = await controller.dispatch({ type: "run" });
	assert.equal(result.stage, "awaiting-review", JSON.stringify(result));
	assert.equal(await readFile(join(f.cwd, "hello.txt"), "utf8"), "after\n");
	assert.equal(approvals, 1);
	const attempt = saved?.workItems[0]?.attempts[0];
	assert.ok(attempt?.result);
	assert.ok(attempt.evidence);
	assert.equal(attempt.result.summary, "挨拶を更新した");
	assert.notEqual(attempt.evidence.before.id, attempt.evidence.after.id);
	assert.equal(attempt.evidence.tools[0]?.status, "completed");
	assert.equal(attempt.evidence.approvals[0]?.kind, "allow");
	assert.equal(runtime.status().running, false);
});

void test("承認待ちの Pi 実行を停止しても、確認済みの根拠と履歴を保存する", async (t) => {
	const f = await piFixture(t);
	await prepareRepository(f.cwd);
	f.model.replies.push({
		name: "write",
		arguments: { path: "hello.txt", content: "cancelled" },
	});
	const { runtime, repository, backend, createRuntime } =
		await dlcRuntimeFixture(t, f.cwd, () => f.controller());
	const controller = await DlcController.open(
		plannedIntent(),
		runtime,
		{
			save: (state, revision) => repository.save(state, revision),
		},
		() => "attempt",
	);
	const run = controller.dispatch({ type: "run" });
	await until(() => backend.snapshot().permissions.length === 1);
	const managed = backend.snapshot();
	assert.ok(managed.sessionId !== null);
	assert.ok(managed.runId !== null);
	await controller.dispatch({ type: "cancel" });
	await run;
	const state = await repository.load(plannedIntent().intentId);
	const attempt = state.workItems[0]?.attempts[0];
	assert.equal(attempt?.status, "cancelled");
	assert.equal(attempt.evidence?.outcome, "cancelled");
	assert.equal(attempt.evidence.before.id, attempt.evidence.after.id);
	assert.equal(attempt.evidence.tools[0]?.status, "cancelled");
	assert.equal(await readFile(join(f.cwd, "hello.txt"), "utf8"), "before\n");
	assert.equal(
		(await repository.conversation(state.intentId, "attempt")).permissions
			.length,
		0,
	);
	assert.equal(runtime.status().running, false);
	// 表示を通常チャットへ戻しても、DLC 会話の所有権と古い承認の拒否を維持する。
	backend.selectMode("chat");
	const restarted = createRuntime();
	t.after(() => restarted.dispose());
	await assert.rejects(
		restarted.receive({
			type: "prompt/send",
			requestId: "manual-after-dlc",
			sessionId: managed.sessionId,
			text: "手動ターン",
		}),
		/DLC セッション/,
	);
	await assert.rejects(
		restarted.receive({
			type: "permission/respond",
			requestId: "stale-approval",
			sessionId: managed.sessionId,
			runId: managed.runId,
			permissionId: managed.permissions[0]!.id,
			optionId: managed.permissions[0]!.options[0]!.id,
		}),
		/DLC セッション/,
	);
});

void test("Pi が成功を自己申告してもファイル変更がなければ失敗する", async (t) => {
	const f = await piFixture(t);
	await prepareRepository(f.cwd);
	f.model.replies.push(
		JSON.stringify({
			attemptId: "attempt",
			workItemId: "00000000-0000-4000-8000-000000000023:task:1",
			outcome: "implemented",
			summary: "更新済み",
			changedPaths: ["hello.txt"],
		}),
	);
	const { runtime } = await dlcRuntimeFixture(t, f.cwd, () => f.controller());
	const controller = await DlcController.open(
		plannedIntent(),
		runtime,
		{ save: () => Promise.resolve() },
		() => "attempt",
	);
	const result = await controller.dispatch({ type: "run" });
	assert.equal(result.workItems[0]?.status, "failed");
	assert.match(result.workItems[0].detail ?? "", /実際のソース変更/);
	assert.equal(await readFile(join(f.cwd, "hello.txt"), "utf8"), "before\n");
});

void test("未対応の継続方式や権限縮小を実行前に拒否する", async (t) => {
	const f = await piFixture(t);
	await prepareRepository(f.cwd);
	let created = 0;
	const { runtime } = await dlcRuntimeFixture(t, f.cwd, () => {
		created++;
		return f.controller();
	});
	const request: ExecutionRequest = {
		intentId: "00000000-0000-4000-8000-000000000023",
		request: "request",
		workItemId: "work",
		attemptId: "attempt",
		title: "title",
		instructions: "work",
		paths: ["hello.txt"],
		continuity: "continue",
		policy: "workspace-inherit",
	};
	assert.throws(
		() => runtime.run(request, new AbortController().signal),
		/対応しています/,
	);
	assert.throws(
		() =>
			runtime.run(
				{ ...request, continuity: "fresh", policy: "read-only" },
				new AbortController().signal,
			),
		/対応しています/,
	);
	assert.equal(created, 1);
});

void test("staged・unstaged・untracked を含む実内容でスナップショットを識別する", async (t) => {
	const f = await piFixture(t);
	await prepareRepository(f.cwd);
	const signal = new AbortController().signal;
	const initial = await collectSourceSnapshot(f.cwd, signal);
	await writeFile(join(f.cwd, "hello.txt"), "staged\n");
	const unstaged = await collectSourceSnapshot(f.cwd, signal);
	await execute("git", ["-C", f.cwd, "add", "hello.txt"], {
		windowsHide: true,
	});
	const staged = await collectSourceSnapshot(f.cwd, signal);
	assert.notEqual(unstaged.id, staged.id);
	assert.deepEqual(unstaged.files, staged.files);
	await writeFile(join(f.cwd, "hello.txt"), "unstaged\n");
	await writeFile(join(f.cwd, "new.txt"), "untracked\n");
	const dirty = await collectSourceSnapshot(f.cwd, signal);
	assert.notEqual(initial.id, staged.id);
	assert.notEqual(staged.id, dirty.id);
	assert.equal(initial.baseCommit, dirty.baseCommit);
	assert.ok(dirty.files.some((file) => file.path === "new.txt"));
});

void test("Codex の通信と完了通知も同じ Runtime Port で実装結果へ変換する", async (t) => {
	const f = await codexFixture(t);
	await prepareRepository(f.cwd);
	const session = f.controller();
	const { runtime, backend } = await dlcRuntimeFixture(
		t,
		f.cwd,
		() => session,
		undefined,
		"codex",
	);
	const dlc = await DlcController.open(
		plannedIntent(),
		runtime,
		{ save: () => Promise.resolve() },
		() => "attempt",
	);
	const run = dlc.dispatch({ type: "run" });
	await until(
		() => f.state.turn === 1 && session.snapshot().run === "running",
		() => session.snapshot(),
	);
	const threadId = session.snapshot().sessionId;
	const turnId = "turn-1";
	// 代替 App Server の外部境界でファイル変更とプロトコル通知を発行する。
	await writeFile(join(f.cwd, "hello.txt"), "codex\n");
	f.notify("item/completed", {
		threadId,
		turnId,
		item: {
			id: "patch",
			type: "fileChange",
			status: "completed",
			changes: [
				{ path: "hello.txt", diff: "@@ -1 +1 @@\n-before\n+codex" },
			],
		},
	});
	f.notify("item/completed", {
		threadId,
		turnId,
		item: {
			id: "result",
			type: "agentMessage",
			text: JSON.stringify({
				attemptId: "attempt",
				workItemId: "00000000-0000-4000-8000-000000000023:task:1",
				outcome: "implemented",
				summary: "変更した",
				changedPaths: ["hello.txt"],
			}),
		},
	});
	f.notify("turn/completed", {
		threadId,
		turn: { id: turnId, status: "completed", items: [] },
	});
	const result = await run;
	const conversation = backend.conversation(
		plannedIntent().intentId,
		"attempt",
	);
	assert.deepEqual(
		Object.entries(conversation ?? {})
			.filter(
				([key, value]) =>
					key !== "revision" && !validStateField(key, value),
			)
			.map(([key, value]) => ({ key, value })),
		[],
	);
	assert.equal(result.stage, "awaiting-review", JSON.stringify(result));
	assert.equal(
		f.requests.filter((request) => request.method === "turn/start").length,
		1,
	);
});
