// Git で作成した Worktree と本番の Pi ツール・承認経路を使い、main/A/B の実行と停止を分離して検証する。
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, unlink, symlink } from "node:fs/promises";
import { join } from "node:path";
import { piFixture, until } from "../support/pi";
import { BackendRuntime } from "../../apps/vscode-nerita/src/extension/session/BackendRuntime";
import {
	DirectoryRuns,
	DirectoryRunConflictError,
	type DirectoryRun,
	type DirectoryRunStorage,
} from "../../apps/vscode-nerita/src/extension/session/DirectoryRuns";
import { WorktreeManager } from "../../apps/vscode-nerita/src/extension/dlc/WorktreeManager";
import { directoryRunStorage } from "../../apps/vscode-nerita/src/extension/dlc/DirectoryRunStorage";
import type { ChatState } from "@nerita/shared/chatState";
import type { HostMessage } from "@nerita/shared/messages";
import { PiSessionController } from "../../apps/vscode-nerita/src/extension/backends/pi/PiSessionController";

const execute = promisify(execFile);
const ids = [
	"00000000-0000-4000-8000-000000000001",
	"00000000-0000-4000-8000-000000000002",
	"00000000-0000-4000-8000-000000000003",
];

async function prepareWorktrees(t: TestContext) {
	const main = await piFixture(t);
	await writeFile(join(main.cwd, "hello.txt"), "before\n");
	await execute("git", ["init", main.cwd], { windowsHide: true });
	await execute("git", ["-C", main.cwd, "config", "core.autocrlf", "false"], {
		windowsHide: true,
	});
	await execute("git", ["-C", main.cwd, "add", "hello.txt"], {
		windowsHide: true,
	});
	await execute(
		"git",
		[
			"-C",
			main.cwd,
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.test",
			"commit",
			"-m",
			"initial",
		],
		{ windowsHide: true },
	);
	const manager = new WorktreeManager(main.cwd, join(main.root, "host"));
	const a = await manager.create();
	const b = await manager.create();
	return { main, a, b, manager };
}

async function pending(
	runtime: BackendRuntime,
	intentId: string,
): Promise<ChatState> {
	runtime.selectDlc(intentId);
	await until(
		() => runtime.snapshot().permissions.length === 1,
		() => runtime.snapshot(),
	);
	return runtime.snapshot();
}
async function allow(runtime: BackendRuntime, state: ChatState) {
	const permission = state.permissions[0]!;
	await runtime.receive({
		type: "permission/respond",
		requestId: permission.id,
		sessionId: state.sessionId!,
		runId: state.runId!,
		permissionId: permission.id,
		optionId: permission.options.find((option) => option.kind === "allow")!
			.id,
	});
}

async function concurrentRuntime(t: TestContext) {
	const { main, a, b } = await prepareWorktrees(t);
	const workers = [main, await piFixture(t), await piFixture(t)];
	const roots = [main.cwd, a.root, b.root];
	for (const [index, worker] of workers.entries()) {
		await worker.trust.setUserTrust(roots[index]!, true);
		worker.storage("global");
		worker.model.replies.push(
			{
				name: "write",
				arguments: { path: "hello.txt", content: `after-${index}\n` },
			},
			"done",
		);
	}
	const runtime = new BackendRuntime((_backend, root) => {
		const index = root === undefined ? 0 : roots.indexOf(root);
		assert.ok(index >= 0);
		return workers[index]!.controller(undefined, roots[index]);
	});
	t.after(() => runtime.dispose());
	await runtime.receive({
		type: "connection/retry",
		requestId: "connect-chat",
	});
	return { main, a, b, roots, runtime };
}

/** DLC の状態通知が通常チャットへ混入しないことを、実際の購読で観測する。 */
async function observeChatView(t: TestContext, runtime: BackendRuntime) {
	const chat = runtime.scope("chat");
	const previousChatId = chat.snapshot().sessionId;
	await chat.receive({ type: "session/new", requestId: "new-normal-chat" });
	assert.notEqual(chat.snapshot().sessionId, previousChatId);
	const chatState = chat.snapshot();
	const chatEvents: HostMessage[] = [];
	const unsubscribe = chat.subscribe((event) => chatEvents.push(event));
	t.after(unsubscribe);

	return { chatState, chatEvents };
}

/** 表示先の ID 照合と再表示を確認し、実行中の会話へ手動ターンを追加させない。 */
async function verifyScopedConversations(
	runtime: BackendRuntime,
	states: ChatState[],
	normal: Awaited<ReturnType<typeof observeChatView>>,
) {
	const { chatState, chatEvents } = normal;
	const chat = runtime.scope("chat");
	const conversation = runtime.scope("dlc");
	assert.equal(conversation.snapshot().sessionId, states[2]!.sessionId);
	assert.equal(chat.snapshot().sessionId, chatState.sessionId);
	assert.equal(chat.snapshot().revision, chatState.revision);
	assert.equal(chatEvents.length, 0);
	const permission = states[2]!.permissions[0]!;
	const response = {
		type: "permission/respond",
		requestId: "scoped-approval",
		sessionId: states[2]!.sessionId!,
		runId: states[2]!.runId!,
		permissionId: permission.id,
		optionId: permission.options[0]!.id,
	};
	await assert.rejects(chat.receive(response));
	runtime.selectDlc(ids[0]);
	await assert.rejects(conversation.receive(response));
	assert.equal(runtime.activeDlcs().length, 3);
	runtime.selectDlc(ids[2]);
	await conversation.receive({ type: "ui/ready" });
	assert.equal(conversation.snapshot().sessionId, states[2]!.sessionId);
	await assert.rejects(
		conversation.receive({
			type: "prompt/send",
			requestId: "no-manual-turn",
			sessionId: states[2]!.sessionId!,
			text: "追加の指示",
		}),
	);
}

void test("main/A/B を並行実行し、A の停止が B の承認・書込みと main の実行を停止しない", async (t) => {
	const { main, a, b, roots, runtime } = await concurrentRuntime(t);
	runtime.selectMode("dlc");
	const normal = await observeChatView(t, runtime);
	const runs = roots.map((root, index) =>
		runtime.executeDlc(
			{
				intentId: ids[index]!,
				attemptId: `attempt-${index}`,
				backend: "pi",
				prompt: "write hello.txt",
				root,
			},
			new AbortController().signal,
		),
	);
	const states = [];
	for (const id of ids) {
		states.push(await pending(runtime, id));
	}
	assert.equal(runtime.activeDlcs().length, 3);
	assert.deepEqual(
		states.map((state) => state.cwd),
		roots,
	);
	await verifyScopedConversations(runtime, states, normal);
	await assert.rejects(
		runtime.executeDlc(
			{
				intentId: "duplicate",
				attemptId: "duplicate",
				backend: "pi",
				prompt: "write",
				root: a.root,
			},
			new AbortController().signal,
		),
	);
	runtime.selectMode("chat");
	await assert.rejects(
		runtime.receive({
			type: "prompt/send",
			requestId: "conflict",
			sessionId: runtime.snapshot().sessionId,
			text: "write",
		}),
	);
	runtime.selectMode("dlc");
	await runtime.stopDlc("attempt-1");
	await runs[1];
	assert.equal(
		(await pending(runtime, ids[2]!)).sessionId,
		states[2]!.sessionId,
	);
	await allow(runtime, states[2]!);
	await runs[2];
	assert.equal(
		await readFile(join(b.root, "hello.txt"), "utf8"),
		"after-2\n",
	);
	assert.equal(await readFile(join(a.root, "hello.txt"), "utf8"), "before\n");
	assert.equal(
		await readFile(join(main.cwd, "hello.txt"), "utf8"),
		"before\n",
	);
	await assert.rejects(allow(runtime, states[1]!));
	await allow(runtime, states[0]!);
	await runs[0];
	assert.equal(
		await readFile(join(main.cwd, "hello.txt"), "utf8"),
		"after-0\n",
	);
});

void test("Worktree の削除は Git の除外対象のファイルと書込み実行を検出し、保持した Worktree から再確認できる", async (t) => {
	const { main, a, manager } = await prepareWorktrees(t);
	const runs = await directoryRunStorage(join(main.root, "host"));
	const release = await runs.acquire(a.root);
	const otherWindow = await directoryRunStorage(join(main.root, "host"));
	await assert.rejects(
		otherWindow.acquire(a.root),
		DirectoryRunConflictError,
	);
	await release();
	await writeFile(join(main.cwd, ".git/info/exclude"), "*.tmp\n");
	await writeFile(join(a.root, "private.tmp"), "keep");
	await assert.rejects(manager.remove(a.id));
	assert.equal(await readFile(join(a.root, "private.tmp"), "utf8"), "keep");
	await unlink(join(a.root, "private.tmp"));
	await manager.remove(a.id);
	await assert.rejects(manager.target(a.id));
	await assert.rejects(
		new WorktreeManager(
			(await manager.list()).find((target) => !target.main)!.root,
			join(main.root, "host"),
		).create(),
		/main/,
	);
});

void test("バックエンドの終了を確認できなかった場合は、入力・根拠を保存する予約も解放しない", async (t) => {
	const f = await piFixture(t);
	f.storage("global");
	f.model.replies.push("done");
	let records: DirectoryRun[] = [];
	const storage: DirectoryRunStorage = {
		update: (operation) => {
			records = operation(records);
			return Promise.resolve();
		},
	};
	const failed = new PiSessionController(
		f.factory((native) => {
			assert.ok(native.close);
			const close = native.close.bind(native);
			native.close = async () => {
				await close();
				throw new Error("ネイティブ終了確認に失敗");
			};
		}),
	);
	t.after(() => assert.rejects(failed.dispose()));
	const runtime = new BackendRuntime(
		(_backend, root) => {
			return root === undefined ? f.controller() : failed;
		},
		undefined,
		new DirectoryRuns(storage),
	);
	t.after(() => runtime.dispose());
	await assert.rejects(
		runtime.withDirectory(f.cwd, (reservation) =>
			runtime.executeDlc(
				{
					intentId: ids[0]!,
					attemptId: "uncertain",
					backend: "pi",
					prompt: "done",
					root: f.cwd,
				},
				new AbortController().signal,
				reservation,
			),
		),
	);
	await assert.rejects(
		new DirectoryRuns(storage).acquire(f.cwd),
		DirectoryRunConflictError,
	);
	assert.deepEqual(runtime.runningDirectories(), [f.cwd]);
});

void test("同一プロジェクトの別 Worktree の Git 管理情報に差し替えた作業ディレクトリを一覧・再割当で拒否する", async (t) => {
	const { a, b, manager } = await prepareWorktrees(t);
	const original = await readFile(join(a.root, ".git"), "utf8");
	await unlink(join(a.root, ".git"));
	await writeFile(
		join(a.root, ".git"),
		await readFile(join(b.root, ".git"), "utf8"),
	);
	await assert.rejects(manager.list());
	await assert.rejects(manager.target(a.id));
	await unlink(join(a.root, ".git"));
	await writeFile(join(a.root, ".git"), original);
	assert.equal((await manager.target(a.id)).root, a.root);
	assert.equal((await manager.target(b.id)).root, b.root);
});

void test("実体パス・大小文字・junction・親子ディレクトリで Run の排他を迂回できない", async (t) => {
	const { main, a, b } = await prepareWorktrees(t);
	const runs = new DirectoryRuns();
	const release = await runs.acquire(a.root);
	const child = join(a.root, "child");
	await mkdir(child);
	const alias = join(main.root, "alias");
	await symlink(a.root, alias, "junction");
	await assert.rejects(runs.acquire(alias), DirectoryRunConflictError);
	await assert.rejects(runs.acquire(child), DirectoryRunConflictError);
	if (process.platform === "win32") {
		await assert.rejects(
			runs.acquire(a.root.toUpperCase()),
			DirectoryRunConflictError,
		);
	}
	const independent = await runs.acquire(b.root);
	await independent();
	await release();
	const next = await runs.acquire(a.root);
	await next();
});
