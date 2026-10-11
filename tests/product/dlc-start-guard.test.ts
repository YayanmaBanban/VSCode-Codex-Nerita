// 実際の Host・Git・SDK と共有予約を使い、実行開始が保留されても失敗履歴を追加せず、既存の Run を停止しないことを確認する。
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DirectoryRuns } from "../../apps/vscode-nerita/src/extension/session/DirectoryRuns";
import { IntentRepository } from "../../apps/vscode-nerita/src/extension/dlc/IntentRepository";
import { dlcHostFixture } from "../support/dlcHost";
import { until } from "../support/pi";
import type { DlcHost } from "../../apps/vscode-nerita/src/extension/dlc/DlcHost";
import type { DlcAction } from "@nerita/shared/dlc/contracts";
import type { IntentState } from "@nerita/dlc/state";

void test("共有 main の開始を履歴なしで保留し、既存 Run を維持したまま作成・信頼した Worktree から手動で並列実行する", async (t) => {
	const { f, runtime, host, intentId, action } = await dlcHostFixture(t);
	f.model.replies.push({
		name: "write",
		arguments: { path: "hello.txt", content: "main\n" },
	});
	const firstRun = sendAction(host, intentId, { type: "run" });
	await until(() => runtime.scope("dlc").snapshot().permissions.length === 1);
	const firstState = runtime.scope("dlc").snapshot();

	const secondId = await createPlannedIntent(host);
	const held = () =>
		host.view().intents.find((item) => item.intentId === secondId)
			?.startHold;
	const before = host.view().selected!;
	assert.equal(held()?.reason, "worktree-required");
	const requests = f.model.requests.length;
	await sendAction(host, secondId, { type: "run" });
	assert.match(host.view().error!, /別の実行/);
	assert.deepEqual(host.view().selected, before);
	assert.equal(f.model.requests.length, requests);
	assert.deepEqual(
		runtime.activeDlcs().map((run) => run.intentId),
		[intentId],
	);

	await host.receive({
		type: "dlc/worktreeCreate",
		requestId: "create-while-running",
	});
	assert.equal(host.view().error, null);
	const target = host.view().targets.find((item) => !item.main);
	assert.ok(target);
	await host.receive({
		type: "dlc/target",
		requestId: "assign",
		intentId: secondId,
		revision: before.revision,
		targetId: target.id,
	});
	assert.equal(host.view().error, null);
	assert.equal(held()?.reason, "trust-required");
	await sendAction(host, secondId, { type: "run" });
	assert.match(host.view().error!, /Nerita Trust/);
	assert.deepEqual(host.view().selected, before);
	assert.equal(f.model.requests.length, requests);

	await f.trust.setUserTrust(target.directory, true);
	await host.receive({ type: "dlc/read", requestId: "recheck" });
	assert.equal(host.view().error, null);
	assert.equal(held(), undefined);
	assert.equal(f.model.requests.length, requests);
	f.model.replies.push({
		name: "write",
		arguments: { path: "hello.txt", content: "worktree\n" },
	});
	const secondRun = sendAction(host, secondId, { type: "run" });
	await until(
		() =>
			runtime.activeDlcs().length === 2 &&
			runtime.scope("dlc").snapshot().permissions.length === 1,
	);
	assert.equal(runtime.scope("dlc").snapshot().cwd, target.directory);
	await sendAction(host, secondId, { type: "cancel" });
	await secondRun;
	await host.receive({ type: "dlc/select", requestId: "first", intentId });
	assert.equal(
		runtime.scope("dlc").snapshot().sessionId,
		firstState.sessionId,
	);
	assert.equal(
		runtime.scope("dlc").snapshot().permissions[0]?.id,
		firstState.permissions[0]?.id,
	);
	assert.equal(
		await readFile(join(target.directory, "hello.txt"), "utf8"),
		"before\n",
	);
	await action({ type: "cancel" });
	await firstRun;
	assert.equal(await readFile(join(f.cwd, "hello.txt"), "utf8"), "before\n");
});

/** 操作直前に表示されている版を使い、実行結果は呼び出し側で確認する。 */
function sendAction(host: DlcHost, intentId: string, action: DlcAction) {
	return host.receive({
		type: "dlc/action",
		requestId: action.type,
		intentId,
		revision: host.view().selected!.revision,
		action,
	});
}

/** main を共有する2つ目の Intent を、作成・タスク登録の製品経路で準備する。 */
async function createPlannedIntent(host: DlcHost) {
	await host.receive({
		type: "dlc/create",
		requestId: "second",
		title: "並列実行",
		request: "挨拶を変更する",
		profile: "classic",
		projectType: "brownfield",
	});
	assert.equal(host.view().error, null);
	const intentId = host.view().selected!.intentId;
	await sendAction(host, intentId, {
		type: "plan",
		tasks: [
			{
				title: "挨拶",
				instructions: "hello.txt を変更する",
				paths: ["hello.txt"],
			},
		],
	});
	assert.equal(host.view().error, null);
	return intentId;
}

void test("別 Runtime の予約で開始を保留し、終了後の再確認でも自動実行せず同じ版・履歴から手動実行できる", async (t) => {
	const { f, runtime, host, intentId, action } = await dlcHostFixture(t);
	const before = host.view().selected!;
	const release = await new DirectoryRuns().acquire(f.cwd);
	t.after(release);
	await host.receive({
		type: "dlc/action",
		requestId: "other-window",
		intentId,
		revision: before.revision,
		action: { type: "run" },
	});
	assert.match(host.view().error!, /別の実行/);
	assert.deepEqual(host.view().selected, before);
	assert.equal(
		host.view().intents.find((item) => item.intentId === intentId)
			?.startHold?.reason,
		"worktree-required",
	);
	assert.equal(f.model.requests.length, 0);
	assert.equal(runtime.activeDlcs().length, 0);

	await release();
	await host.receive({ type: "dlc/read", requestId: "released" });
	assert.equal(host.view().error, null);
	assert.equal(
		host.view().intents.find((item) => item.intentId === intentId)
			?.startHold,
		undefined,
	);
	assert.deepEqual(host.view().selected, before);
	assert.equal(f.model.requests.length, 0);
	f.model.replies.push("変更なし");
	await action({ type: "run" });
	assert.equal(host.view().selected!.workItems[0]?.attempts.length, 1);
	assert.equal(f.model.requests.length, 1);
});

void test("割り当てた Worktree の Git 登録が消失した場合は、保存した工程・版・実行履歴を変えず開始を保留する", async (t) => {
	const { f, host, intentId } = await dlcHostFixture(t);
	await host.receive({ type: "dlc/worktreeCreate", requestId: "create" });
	assert.equal(host.view().error, null);
	const target = host.view().targets.find((item) => !item.main)!;
	await f.trust.setUserTrust(target.directory, true);
	await host.receive({
		type: "dlc/target",
		requestId: "assign",
		intentId,
		revision: host.view().selected!.revision,
		targetId: target.id,
	});
	assert.equal(host.view().error, null);
	const before = host.view().selected!;
	await promisify(execFile)(
		"git",
		["-C", f.cwd, "worktree", "remove", "--", target.directory],
		{ windowsHide: true },
	);
	await host.receive({
		type: "dlc/action",
		requestId: "missing",
		intentId,
		revision: before.revision,
		action: { type: "run" },
	});
	assert.match(host.view().error!, /存在しません/);
	assert.deepEqual(host.view().selected, before);
	assert.equal(
		host.view().intents.find((item) => item.intentId === intentId)
			?.startHold?.reason,
		"unavailable",
	);
	assert.equal(f.model.requests.length, 0);
});

void test("開始条件の再確認と Worktree の選択が重なっても割当を保存し、工程・版・履歴を変更しない", async (t) => {
	const { f, host, intentId } = await dlcHostFixture(t);
	await host.receive({ type: "dlc/worktreeCreate", requestId: "create" });
	assert.equal(host.view().error, null);
	const target = host.view().targets.find((item) => !item.main)!;
	await f.trust.setUserTrust(target.directory, true);
	await host.receive({ type: "dlc/read", requestId: "trusted" });
	const before = host.view().selected!;
	await Promise.all([
		host.receive({ type: "dlc/read", requestId: "recheck" }),
		host.receive({
			type: "dlc/target",
			requestId: "select-during-recheck",
			intentId,
			revision: before.revision,
			targetId: target.id,
		}),
	]);
	assert.equal(host.view().error, null);
	assert.equal(host.view().targetId, target.id);
	assert.deepEqual(host.view().selected, before);
	assert.equal(host.view().intents[0]?.startHold, undefined);
	assert.equal(f.model.requests.length, 0);
});

for (const order of ["開始受付が先", "再確認が先"]) {
	void test(`${order}でも実行中の Run を中断済みとして扱わず、同じ実行への停止要求と根拠の保存を維持する`, async (t) => {
		const { f, runtime, host, intentId } = await dlcHostFixture(t);
		const storage = pauseStorageReads(t);
		f.model.replies.push({
			name: "write",
			arguments: { path: "hello.txt", content: "after\n" },
		});
		const recheck = () =>
			host.receive({ type: "dlc/read", requestId: "recheck-starting" });
		let read: Promise<void>;
		if (order === "再確認が先") {
			read = recheck();
			await until(() => storage.projections.waiting);
		}
		const run = sendAction(host, intentId, { type: "run" });
		await until(() => storage.load.waiting);
		if (order === "開始受付が先") {
			read = recheck();
			await until(() => storage.projections.waiting);
		}
		storage.load.release();
		await until(
			() => runtime.scope("dlc").snapshot().permissions.length === 1,
		);
		const active = runtime.scope("dlc").snapshot();
		storage.projections.release();
		await read!;
		assert.equal(host.view().error, null);
		assert.equal(host.view().selected!.workItems[0]?.status, "running");
		assert.equal(
			runtime.scope("dlc").snapshot().sessionId,
			active.sessionId,
		);
		await sendAction(host, intentId, { type: "cancel" });
		await run;
		assert.equal(host.view().error, null);
		assert.equal(runtime.activeDlcs().length, 0);
		await recheck();
		const attempt = storage.states.get(intentId)?.workItems[0]?.attempts[0];
		assert.equal(attempt?.status, "cancelled");
		assert.equal(
			attempt.evidence?.outcome,
			"cancelled",
			JSON.stringify(attempt),
		);
		assert.equal(attempt.evidence.before.complete, true);
		assert.equal(attempt.evidence.after.complete, true);
		assert.equal(attempt.evidence.before.id, attempt.evidence.after.id);
		assert.equal(
			await readFile(join(f.cwd, "hello.txt"), "utf8"),
			"before\n",
		);
		assert.equal(f.model.requests.length, 1);
	});
}

/** 読込み結果の返却だけを待機させ、`IntentRepository` の読込み・ロック・復旧処理はそのまま使う。 */
function pauseStorageReads(t: TestContext) {
	const pause = () => {
		let release!: () => void;
		const promise = new Promise<void>((resolve) => {
			release = resolve;
		});
		t.after(release);
		return { waiting: false, promise, release };
	};
	const load = pause();
	const projections = pause();
	const states = new Map<string, IntentState>();
	// 元のメソッドを実インスタンスに束縛して使い、保存値を代替しない。
	// eslint-disable-next-line @typescript-eslint/unbound-method
	const loadIntent = IntentRepository.prototype.load;
	// eslint-disable-next-line @typescript-eslint/unbound-method
	const readProjections = IntentRepository.prototype.projections;
	t.mock.method(
		IntentRepository.prototype,
		"load",
		async function (this: IntentRepository, id: string) {
			const state = await loadIntent.call(this, id);
			states.set(id, state);
			if (!load.waiting) {
				load.waiting = true;
				await load.promise;
			}
			return state;
		},
	);
	t.mock.method(
		IntentRepository.prototype,
		"projections",
		async function (this: IntentRepository) {
			const values = await readProjections.call(this);
			if (!projections.waiting) {
				projections.waiting = true;
				await projections.promise;
			}
			return values;
		},
	);
	return { load, projections, states };
}
