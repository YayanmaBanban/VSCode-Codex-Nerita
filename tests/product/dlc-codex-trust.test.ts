// App Server だけを代替し、未信頼の main・Worktree で本番の DLC と Codex 接続を検証する。
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BackendId } from "@nerita/shared/backend";
import { createBackend } from "../../apps/vscode-nerita/src/extension/backends/createBackend";
import { DlcHost } from "../../apps/vscode-nerita/src/extension/dlc/DlcHost";
import { BackendRuntime } from "../../apps/vscode-nerita/src/extension/session/BackendRuntime";
import { WorkspaceTrustStore } from "../../apps/vscode-nerita/src/extension/security/trust/WorkspaceTrustStore";
import { codexFixture } from "../support/codex";
import { hostContext, prepareRepository } from "../support/dlcHost";
import { until } from "../support/pi";

void test("Codex DLC は Nerita Trust 未設定の main と Worktree を使い、Pi の開始拒否と信頼変更に影響されない", async (t) => {
	const fixture = await prepare(t);
	const intentId = await planIntent(fixture.host);
	await verifyPiHold(fixture, intentId);
	await runCodex(t, fixture, intentId);
});

/** VS Code と App Server の境界を用意し、Host の信頼変更購読も本番と同じ経路へ接続する。 */
async function prepare(t: TestContext) {
	const main = await codexFixture(t);
	await prepareRepository(main.cwd);
	const previousLocal = process.env.LOCALAPPDATA;
	process.env.LOCALAPPDATA = join(main.extensionPath, "local");
	t.after(() => {
		if (previousLocal === undefined) {
			delete process.env.LOCALAPPDATA;
		} else {
			process.env.LOCALAPPDATA = previousLocal;
		}
	});
	const context = hostContext(main.cwd, "codex");
	Object.assign(context, { extensionUri: { fsPath: main.extensionPath } });
	let failSave = false;
	const trust = new WorkspaceTrustStore({
		read: () => undefined,
		write: () =>
			failSave
				? Promise.reject(new Error("Trust 保存失敗"))
				: Promise.resolve(),
	});
	const runtime = new BackendRuntime((backend, root) =>
		createBackend(context, trust, backend ?? "codex", root),
	);
	const unsubscribe = trust.onChange((root) => runtime.invalidateTrust(root));
	const host = new DlcHost(context, trust, runtime);
	t.after(async () => {
		unsubscribe();
		await host.dispose();
		await runtime.dispose();
	});
	await runtime.receive({ type: "connection/retry", requestId: "connect" });
	assert.equal(runtime.scope("chat").snapshot().connection, "ready");
	return {
		main,
		trust,
		runtime,
		host,
		failSave: () => {
			failSave = true;
		},
	};
}

/** 作成・計画の操作は未信頼の main から受け付けられる。 */
async function planIntent(host: DlcHost) {
	await host.receive({
		type: "dlc/create",
		requestId: "create",
		title: "Codex Trust",
		request: "挨拶を変更する",
		profile: "classic",
		projectType: "brownfield",
	});
	assert.equal(host.view().error, null);
	const intentId = host.view().selected!.intentId;
	await host.receive({ type: "dlc/read", requestId: "read" });
	assert.equal(host.view().error, null);
	await host.receive({
		type: "dlc/action",
		requestId: "plan",
		intentId,
		revision: host.view().selected!.revision,
		action: {
			type: "plan",
			tasks: [
				{
					title: "挨拶",
					instructions: "hello.txt を変更する",
					paths: ["hello.txt"],
				},
			],
		},
	});
	assert.equal(host.view().error, null);
	assert.equal(host.view().intents[0]?.startHold, undefined);
	return intentId;
}

type Fixture = Awaited<ReturnType<typeof prepare>>;

/** 選択した Intent の保存済み割当に対してバックエンドを変更する。 */
async function selectBackend(
	host: DlcHost,
	intentId: string,
	backend: BackendId,
) {
	await host.receive({
		type: "dlc/backend",
		requestId: backend,
		backend,
		intentId,
		revision: host.view().selected!.revision,
	});
	assert.equal(host.view().error, null);
}

/** 同じ実行先でも Pi は Trust を必須とし、拒否で履歴や Codex のターンを作らない。 */
async function verifyPiHold({ host, main, trust }: Fixture, intentId: string) {
	assert.equal(await trust.trusted(main.cwd), false);
	await selectBackend(host, intentId, "pi");
	assert.equal(host.view().intents[0]?.startHold?.reason, "trust-required");
	const before = host.view().selected;
	await host.receive({
		type: "dlc/action",
		requestId: "pi-denied",
		intentId,
		revision: before!.revision,
		action: { type: "run" },
	});
	assert.match(host.view().error!, /Nerita Trust/);
	assert.deepEqual(host.view().selected, before);
	assert.equal(main.state.turn, 0);
	await selectBackend(host, intentId, "codex");
	assert.equal(host.view().intents[0]?.startHold, undefined);
}

/** 未信頼 Worktree の実行と結果保存は、Trust の取消し・保存失敗を経ても継続する。 */
async function runCodex(
	t: TestContext,
	{ host, runtime, trust, main, failSave }: Fixture,
	intentId: string,
) {
	await host.receive({ type: "dlc/worktreeCreate", requestId: "worktree" });
	assert.equal(host.view().error, null);
	const target = host.view().targets.find((item) => !item.main)!;
	const worktree = await codexFixture(t, target.directory);
	await host.receive({
		type: "dlc/target",
		requestId: "assign",
		intentId,
		revision: host.view().selected!.revision,
		targetId: target.id,
	});
	assert.equal(host.view().error, null);
	assert.equal(await trust.trusted(target.directory), false);
	assert.equal(host.view().intents[0]?.startHold, undefined);
	const run = host.receive({
		type: "dlc/action",
		requestId: "codex-run",
		intentId,
		revision: host.view().selected!.revision,
		action: { type: "run" },
	});
	await until(() => worktree.state.turn === 1 || host.view().error !== null);
	assert.equal(host.view().error, null);
	assert.equal(worktree.state.turn, 1);
	const threadId = runtime.scope("dlc").snapshot().sessionId;
	worktree.notify("turn/started", {
		threadId,
		turn: { id: "turn-1", status: "inProgress", items: [] },
	});
	await trust.setUserTrust(main.cwd, false);
	await trust.setUserTrust(target.directory, false);
	failSave();
	await assert.rejects(trust.setUserTrust(main.cwd, false), /Trust 保存失敗/);
	await host.receive({ type: "dlc/read", requestId: "refresh" });
	assert.equal(host.view().error, null);
	assert.equal(runtime.scope("chat").snapshot().connection, "ready");
	assert.equal(runtime.activeDlcs()[0]?.intentId, intentId);
	assert.equal(
		worktree.requests.some(
			(request) => request.method === "turn/interrupt",
		),
		false,
	);
	await finishCodex(worktree, host, threadId);
	await run;
	assert.equal(host.view().error, null);
	assert.equal(
		host.view().selected?.workItems[0]?.attempts[0]?.status,
		"completed",
		JSON.stringify(host.view().selected?.workItems[0]),
	);
	assert.equal(
		await readFile(join(main.cwd, "hello.txt"), "utf8"),
		"before\n",
	);
	assert.equal(
		await readFile(join(target.directory, "hello.txt"), "utf8"),
		"Codex\n",
	);
}

/** App Server の結果契約を返し、収集された変更と試行が Host に保存されることを検証する。 */
async function finishCodex(
	worktree: Awaited<ReturnType<typeof codexFixture>>,
	host: DlcHost,
	threadId: string | null,
) {
	const item = host.view().selected!.workItems[0]!;
	await writeFile(join(worktree.cwd, "hello.txt"), "Codex\n");
	worktree.notify("item/completed", {
		threadId,
		turnId: "turn-1",
		item: {
			id: "patch",
			type: "fileChange",
			status: "completed",
			changes: [
				{ path: "hello.txt", diff: "@@ -1 +1 @@\n-before\n+Codex" },
			],
		},
	});
	worktree.notify("item/completed", {
		threadId,
		turnId: "turn-1",
		item: {
			id: "result",
			type: "agentMessage",
			text: JSON.stringify({
				attemptId: item.attempts[0]!.id,
				workItemId: item.id,
				outcome: "implemented",
				summary: "変更しました。",
				changedPaths: ["hello.txt"],
			}),
		},
	});
	worktree.notify("turn/completed", {
		threadId,
		turn: { id: "turn-1", status: "completed", items: [] },
	});
}
