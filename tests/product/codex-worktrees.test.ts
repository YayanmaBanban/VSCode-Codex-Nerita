// 外部 App Server だけを代替し、Git で作成した Worktree と本番の接続・承認・停止・分岐を照合する。
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { codexFixture, codexResponseGate } from "../support/codex";
import { until } from "../support/pi";
import { WorktreeManager } from "../../apps/vscode-nerita/src/extension/dlc/WorktreeManager";
import { BackendRuntime } from "../../apps/vscode-nerita/src/extension/session/BackendRuntime";
import type { ChatState } from "@nerita/shared/chatState";
import {
	DirectoryRuns,
	DirectoryRunConflictError,
} from "../../apps/vscode-nerita/src/extension/session/DirectoryRuns";
import { CodexSessionController } from "../../apps/vscode-nerita/src/extension/backends/codex/CodexSessionController";
import type { CodexFactory } from "../../apps/vscode-nerita/src/extension/backends/codex/runtime/connection";
import { setTimeout } from "node:timers/promises";
import { BackendShutdownError } from "../../apps/vscode-nerita/src/extension/session/BackendShutdown";

const execute = promisify(execFile);
type Fixture = Awaited<ReturnType<typeof codexFixture>>;

async function prepare(t: TestContext) {
	const main = await codexFixture(t);
	await writeFile(join(main.cwd, "hello.txt"), "before\n");
	await execute("git", ["init", "--quiet", main.cwd], { windowsHide: true });
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
			"--quiet",
			"-m",
			"initial",
		],
		{ windowsHide: true },
	);
	const manager = new WorktreeManager(
		main.cwd,
		join(main.extensionPath, "host"),
	);
	const a = await manager.create();
	const b = await manager.create();
	const fixtures = [
		main,
		await codexFixture(t, a.root),
		await codexFixture(t, b.root),
	];
	for (const [index, fixture] of fixtures.entries()) {
		fixture.responses.set("thread/start", ({ params }) => {
			assert.equal(params?.cwd, fixture.cwd);
			return {
				thread: { id: `thread-${index}-${++fixture.state.thread}` },
				model: "model-a",
				cwd: fixture.cwd,
			};
		});
	}
	return fixtures;
}

async function pending(runtime: BackendRuntime, f: Fixture, intentId: string) {
	runtime.selectDlc(intentId);
	await until(() => f.state.turn === 1);
	const threadId = runtime.snapshot().sessionId;
	f.notify("turn/started", {
		threadId,
		turn: { id: "turn-1", status: "inProgress", items: [] },
	});
	f.serverRequest("item/commandExecution/requestApproval", {
		threadId,
		turnId: "turn-1",
		itemId: "command",
		command: "write hello.txt",
		cwd: f.cwd,
	});
	await until(() => runtime.snapshot().permissions.length === 1);
	return runtime.snapshot();
}

async function complete(runtime: BackendRuntime, f: Fixture, state: ChatState) {
	const permission = state.permissions[0]!;
	await runtime.receive({
		type: "permission/respond",
		requestId: permission.id,
		sessionId: state.sessionId!,
		runId: state.runId!,
		permissionId: permission.id,
		optionId: "accept",
	});
	await until(() =>
		f.clientResponses.some((response) => response.result !== undefined),
	);
	const { stdout } = await execute(
		process.execPath,
		[
			"-e",
			"require('fs').writeFileSync('hello.txt','after');console.log(process.cwd());",
		],
		{ cwd: f.cwd, windowsHide: true },
	);
	const scope = { threadId: state.sessionId, turnId: "turn-1" };
	f.notify("item/completed", {
		...scope,
		item: {
			id: "command",
			type: "commandExecution",
			command: "write hello.txt",
			cwd: f.cwd,
			status: "completed",
			exitCode: 0,
			aggregatedOutput: stdout,
		},
	});
	f.notify("item/completed", {
		...scope,
		item: { id: "result", type: "agentMessage", text: "done" },
	});
	f.notify("turn/completed", {
		threadId: state.sessionId,
		turn: { id: "turn-1", status: "completed", items: [] },
	});
}

function createRuntime(fixtures: Fixture[]) {
	return new BackendRuntime((_backend, root) => {
		const fixture = fixtures.find(
			(entry) => entry.cwd === (root ?? fixtures[0]!.cwd),
		);
		assert.ok(fixture);
		return fixture.controller();
	});
}
function interrupted(f: Fixture) {
	return f.requests.some((request) => request.method === "turn/interrupt");
}
void test("Codex の main/A/B は実行先を固定し、A の停止後も B と main の承認・コマンドを維持する", async (t) => {
	const fixtures = await prepare(t);
	const runtime = createRuntime(fixtures);
	t.after(() => runtime.dispose());
	runtime.selectMode("dlc");
	const runs = fixtures.map((fixture, index) =>
		runtime.executeDlc(
			{
				intentId: `intent-${index}`,
				attemptId: `attempt-${index}`,
				backend: "codex",
				prompt: "write hello.txt",
				root: fixture.cwd,
			},
			new AbortController().signal,
		),
	);
	const states: ChatState[] = [];
	for (const [index, fixture] of fixtures.entries()) {
		states.push(await pending(runtime, fixture, `intent-${index}`));
	}
	assert.equal(runtime.activeDlcs().length, 3);
	assert.deepEqual(
		states.map((state) => state.cwd),
		fixtures.map((fixture) => fixture.cwd),
	);
	const stopping = runtime.stopDlc("attempt-1");
	await until(() => interrupted(fixtures[1]!));
	fixtures[1]!.notify("turn/completed", {
		threadId: states[1]!.sessionId,
		turn: { id: "turn-1", status: "interrupted", items: [] },
	});
	await stopping;
	await runs[1];
	runtime.selectDlc("intent-2");
	assert.equal(
		runtime.snapshot().permissions[0]?.id,
		states[2]!.permissions[0]?.id,
	);
	await complete(runtime, fixtures[2]!, states[2]!);
	await runs[2];
	assert.equal(
		await readFile(join(fixtures[2]!.cwd, "hello.txt"), "utf8"),
		"after",
	);
	assert.equal(
		await readFile(join(fixtures[1]!.cwd, "hello.txt"), "utf8"),
		"before\n",
	);
	runtime.selectDlc("intent-0");
	await complete(runtime, fixtures[0]!, states[0]!);
	await runs[0];
	assert.equal(
		await readFile(join(fixtures[0]!.cwd, "hello.txt"), "utf8"),
		"after",
	);
	assert.equal(
		runtime.conversation("intent-2", "attempt-2")?.tools[0]?.cwd,
		fixtures[2]!.cwd,
		JSON.stringify(runtime.conversation("intent-2", "attempt-2")?.tools),
	);
});

void test("Codex の分岐は移動先 cwd を送り、新しい ID と応答の実体ディレクトリを検証する", async (t) => {
	const fixtures = await prepare(t);
	const source = fixtures[0]!;
	const target = fixtures[1]!;
	const { client } = await target.factory({}, new AbortController().signal);
	t.after(() => client.dispose());
	target.responses.set("thread/fork", ({ params }) => {
		assert.equal(params?.threadId, "source");
		assert.equal(params.cwd, target.cwd);
		return forkResponse("forked", target.cwd);
	});
	assert.equal((await client.forkThread("source")).thread.id, "forked");
	target.responses.set("thread/fork", () =>
		forkResponse("source", target.cwd),
	);
	await assert.rejects(client.forkThread("source"));
	target.responses.set("thread/fork", () =>
		forkResponse("different", source.cwd),
	);
	await assert.rejects(client.forkThread("source"));
});

function forkResponse(id: string, cwd: string) {
	return {
		thread: {
			id,
			cwd,
			preview: "history",
			name: null,
			updatedAt: 1,
			status: { type: "idle" },
			historyMode: "legacy",
			turns: [],
		},
		cwd,
		model: "model-a",
	};
}

for (const failure of [false, true]) {
	void test(`通常チャットの切断後は旧 Codex の終了${failure ? "失敗でも予約を保持する" : "確認まで予約を保持し、確認後に解放する"}`, async (t) => {
		const f = await codexFixture(t);
		const gate = codexResponseGate();
		let callbacks: Parameters<CodexFactory>[0] | undefined;
		let client: Awaited<ReturnType<CodexFactory>>["client"] | undefined;
		let disposing = false;
		const controller = new CodexSessionController(async (events) => {
			callbacks = events;
			// 取消しに応答しない外部プロセスを再現し、dispose の確認前も実際の RPC を通す。
			const connection = await f.factory(
				events,
				new AbortController().signal,
			);
			client = connection.client;
			const dispose = client.dispose.bind(client);
			client.dispose = async () => {
				disposing = true;
				await gate.response;
				await dispose();
				if (failure) {
					throw new Error("終了通知なし");
				}
			};
			return connection;
		});
		const directories = new DirectoryRuns();
		const runtime = new BackendRuntime(
			() => controller,
			undefined,
			directories,
		);
		t.after(async () => {
			gate.release({});
			if (failure) {
				await assert.rejects(runtime.dispose());
			} else {
				await runtime.dispose();
			}
		});
		await runtime.receive({
			type: "connection/retry",
			requestId: "connect",
		});
		await runtime.receive({
			type: "prompt/send",
			requestId: "send",
			sessionId: runtime.snapshot().sessionId,
			text: "work",
		});
		assert.equal(f.state.turn, 1);
		callbacks!.disconnected!(new Error("切断"));
		await until(() => disposing);
		await setTimeout(50);
		assert.equal(runtime.snapshot().run, "failed");
		assert.equal((await client!.readAccount()).authenticated, true);
		await assert.rejects(
			directories.acquire(f.cwd),
			DirectoryRunConflictError,
		);
		const revisionBeforeDisposal = runtime.snapshot().revision;
		gate.release({});
		if (failure) {
			await until(
				() => runtime.snapshot().revision > revisionBeforeDisposal,
			);
			await assert.rejects(
				directories.acquire(f.cwd),
				DirectoryRunConflictError,
			);
			await runtime.restart();
			await runtime.restart();
			await assert.rejects(
				directories.acquire(f.cwd),
				DirectoryRunConflictError,
			);
		} else {
			await until(() => runtime.runningDirectories().length === 0);
			const release = await directories.acquire(f.cwd);
			await release();
		}
	});
}

void test("Codex の新規 Thread の実効 cwd が別 Worktree なら接続を回収し、turn/start を送らない", async (t) => {
	const f = await codexFixture(t);
	const other = await codexFixture(t);
	f.responses.set("thread/start", () => ({
		thread: { id: "wrong-cwd" },
		model: "model-a",
		cwd: other.cwd,
	}));
	const runtime = new BackendRuntime(() => f.controller());
	t.after(() => runtime.dispose());
	await assert.rejects(
		runtime.executeDlc(
			{
				intentId: "intent",
				attemptId: "wrong-cwd",
				backend: "codex",
				root: f.cwd,
				prompt: "work",
			},
			new AbortController().signal,
		),
	);
	assert.equal(
		f.requests.some((request) => request.method === "turn/start"),
		false,
	);
	assert.equal(runtime.activeDlcs().length, 0);
	await runtime.withDirectory(f.cwd, () => Promise.resolve());
});

void test("Codex の起動失敗後に下位層が終了未確認を返した場合も、DLC の予約を保持する", async (t) => {
	const f = await codexFixture(t);
	const failed = new CodexSessionController(() =>
		Promise.reject(
			new BackendShutdownError(new Error("起動失敗後の終了通知なし")),
		),
	);
	const directories = new DirectoryRuns();
	const runtime = new BackendRuntime(
		(_backend, root) => (root === undefined ? f.controller() : failed),
		undefined,
		directories,
	);
	t.after(() => runtime.dispose());
	t.after(() => assert.rejects(failed.dispose()));
	await assert.rejects(
		runtime.withDirectory(f.cwd, (reservation) =>
			runtime.executeDlc(
				{
					intentId: "intent",
					attemptId: "opening-failed",
					backend: "codex",
					prompt: "work",
					root: f.cwd,
				},
				new AbortController().signal,
				reservation,
			),
		),
	);
	await assert.rejects(directories.acquire(f.cwd), DirectoryRunConflictError);
	assert.equal(f.state.turn, 0);
});
