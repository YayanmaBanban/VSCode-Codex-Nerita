// モデルの HTTP 境界だけを制御し、Pi の実ツール・承認・ソース収集から DLC の結果を確認する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DlcController } from "@nerita/dlc/controller";
import { type ProjectState } from "@nerita/dlc/state";
import { type ExecutionRequest } from "@nerita/dlc/runtime";
import type { Permission } from "@nerita/shared/chatState";
import { plannedProject } from "../support/dlc";
import { piFixture, until } from "../support/pi";
import { codexFixture } from "../support/codex";
import { SessionRuntime } from "../../apps/vscode-nerita/src/extension/dlc/SessionRuntime";
import { collectSourceSnapshot } from "../../apps/vscode-nerita/src/extension/dlc/SourceSnapshot";

const execute = promisify(execFile);
const allowPermission = (permission: Permission) =>
	Promise.resolve(
		permission.options.find((option) => option.kind === "allow"),
	);
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
			workItemId: "project:task:1",
			outcome: "implemented",
			summary: "挨拶を更新した",
			changedPaths: ["hello.txt"],
		}),
	);
	let approvals = 0;
	const runtime = new SessionRuntime(
		f.cwd,
		() => f.controller(),
		(permission) => {
			approvals += 1;
			return allowPermission(permission);
		},
	);
	let saved: ProjectState | undefined;
	const controller = await DlcController.open(
		plannedProject(),
		runtime,
		{
			save: (state) => {
				saved = state;
				return Promise.resolve();
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

void test("Pi が成功を自己申告してもファイル変更がなければ失敗する", async (t) => {
	const f = await piFixture(t);
	await prepareRepository(f.cwd);
	f.model.replies.push(
		JSON.stringify({
			attemptId: "attempt",
			workItemId: "project:task:1",
			outcome: "implemented",
			summary: "更新済み",
			changedPaths: ["hello.txt"],
		}),
	);
	const runtime = new SessionRuntime(
		f.cwd,
		() => f.controller(),
		() => Promise.resolve(undefined),
	);
	const controller = await DlcController.open(
		plannedProject(),
		runtime,
		{ save: () => Promise.resolve() },
		() => "attempt",
	);
	const result = await controller.dispatch({ type: "run" });
	assert.equal(result.workItems[0]?.status, "failed");
	assert.match(result.workItems[0].detail ?? "", /実際のソース変更/);
	assert.equal(await readFile(join(f.cwd, "hello.txt"), "utf8"), "before\n");
});

void test("未対応の継続方式や権限縮小を実行前に拒否する", () => {
	let created = 0;
	const runtime = new SessionRuntime(
		"unused",
		() => {
			created += 1;
			throw new Error("起動されてはいけない");
		},
		() => Promise.resolve(undefined),
	);
	const request: ExecutionRequest = {
		projectId: "project",
		goal: "goal",
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
	assert.equal(created, 0);
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
	const runtime = new SessionRuntime(
		f.cwd,
		() => session,
		() => Promise.resolve(undefined),
	);
	const dlc = await DlcController.open(
		plannedProject(),
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
				workItemId: "project:task:1",
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
	assert.equal(result.stage, "awaiting-review", JSON.stringify(result));
	assert.equal(
		f.requests.filter((request) => request.method === "turn/start").length,
		1,
	);
});
