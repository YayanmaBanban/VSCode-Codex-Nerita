// Host・保存・Pi の会話処理に本番の実装を使い、遅い履歴取得による現在の実行表示の上書きを検出する。
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as vscode from "vscode";
import type { DlcAction } from "@nerita/shared/dlc/contracts";
import { DlcHost } from "../../apps/vscode-nerita/src/extension/dlc/DlcHost";
import { IntentRepository } from "../../apps/vscode-nerita/src/extension/dlc/IntentRepository";
import { BackendRuntime } from "../../apps/vscode-nerita/src/extension/session/BackendRuntime";
import { piFixture, until } from "../support/pi";

const execute = promisify(execFile);

/** 会話・Git・保存処理を代替せず、必要な VS Code の Memento とワークスペースだけを用意する。 */
function hostContext(root: string): vscode.ExtensionContext {
	Object.assign(vscode.workspace, {
		isTrusted: true,
		workspaceFolders: [{ uri: { scheme: "file", fsPath: root } }],
		getConfiguration: () => ({ get: () => "pi" }),
	});
	const records = new Map<string, unknown>();
	const memento = {
		get: (key: string) => records.get(key),
		update: (key: string, value: unknown) => {
			records.set(key, value);
			return Promise.resolve();
		},
	};
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
	return {
		globalState: memento,
		workspaceState: memento,
		subscriptions: [],
	} as unknown as vscode.ExtensionContext;
}

/** VS Code API のみを代替し、ユーザー共通保存を新しい検証領域へ閉じる。 */
async function openHost(t: TestContext) {
	const f = await piFixture(t);
	f.storage("global");
	const previousLocal = process.env.LOCALAPPDATA;
	process.env.LOCALAPPDATA = join(f.root, "local");
	t.after(() => {
		process.env.LOCALAPPDATA = previousLocal;
	});
	await writeFile(join(f.cwd, "hello.txt"), "before\n");
	await execute("git", ["init", "--quiet", f.cwd], { windowsHide: true });
	await execute("git", ["-C", f.cwd, "add", "hello.txt"], {
		windowsHide: true,
	});
	await execute(
		"git",
		[
			"-C",
			f.cwd,
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
	const context = hostContext(f.cwd);
	const runtime = new BackendRuntime((_backend, root) =>
		f.controller(undefined, root ?? f.cwd),
	);
	const host = new DlcHost(context, f.trust, runtime);
	t.after(async () => {
		await host.dispose();
		await runtime.dispose();
	});
	await host.receive({
		type: "dlc/create",
		requestId: "create",
		request: "挨拶を変更する",
		title: "履歴選択",
		profile: "classic",
		projectType: "brownfield",
	});
	assert.equal(host.view().error, null);
	const intentId = host.view().selected!.intentId;
	await host.receive({ type: "dlc/read", requestId: "read" });
	const action = async (actionValue: DlcAction) => {
		await host.receive({
			type: "dlc/action",
			requestId: actionValue.type,
			intentId,
			revision: host.view().selected!.revision,
			action: actionValue,
		});
		assert.equal(host.view().error, null);
	};
	await action({
		type: "plan",
		tasks: [
			{
				title: "挨拶",
				instructions: "hello.txt を更新する",
				paths: ["hello.txt"],
			},
		],
	});
	await host.receive({
		type: "dlc/target",
		requestId: "target",
		intentId,
		revision: host.view().selected!.revision,
		targetId: host.view().targets.find((target) => target.main)!.id,
	});
	assert.equal(host.view().error, null);
	return { f, runtime, host, intentId, action };
}

void test("履歴 A の取得中に実行中 B を選ぶと、遅れた A の応答後も B の会話と承認・停止対象を表示する", async (t) => {
	const { f, runtime, host, intentId, action } = await openHost(t);
	f.model.replies.push("変更なし");
	await action({ type: "run" });
	const item = host.view().selected!.workItems[0]!;
	const historyId = item.attempts[0]!.id;
	const historySessionId = runtime.scope("dlc").snapshot().sessionId;
	assert.ok(historySessionId !== null);
	await action({ type: "retry", workItemId: item.id });
	f.model.replies.push(
		{ name: "write", arguments: { path: "hello.txt", content: "after\n" } },
		"done",
	);
	const running = action({ type: "run" });
	await until(() => runtime.scope("dlc").snapshot().permissions.length === 1);
	const current = runtime.scope("dlc").snapshot();
	const active = runtime.activeDlc()!;
	assert.notEqual(current.sessionId, historySessionId);
	let release!: () => void;
	let reading = false;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	// 元メソッドは下の call で実際のインスタンスへ明示的に束縛し、返却だけを保留する。
	// eslint-disable-next-line @typescript-eslint/unbound-method
	const conversation = IntentRepository.prototype.conversation;
	// 読込み結果は本番の保存処理から取得し、返却の時点だけを保留する。
	t.mock.method(
		IntentRepository.prototype,
		"conversation",
		async function (
			this: IntentRepository,
			intent: string,
			attempt: string,
		) {
			const state = await conversation.call(this, intent, attempt);
			if (attempt === historyId) {
				reading = true;
				await gate;
			}
			return state;
		},
	);
	t.after(async () => {
		release();
		await runtime.stopDlc(active.attemptId);
		await running;
	});
	const older = host.receive({
		type: "dlc/attempt",
		requestId: "history-a",
		intentId,
		attemptId: historyId,
	});
	await until(() => reading);
	await host.receive({
		type: "dlc/attempt",
		requestId: "current-b",
		intentId,
		attemptId: active.attemptId,
	});
	assert.equal(runtime.scope("dlc").snapshot().sessionId, current.sessionId);
	release();
	await older;
	assert.equal(host.view().error, null);
	assert.equal(runtime.scope("dlc").snapshot().sessionId, current.sessionId);
	assert.equal(runtime.scope("dlc").snapshot().runId, current.runId);
	assert.equal(
		runtime.scope("dlc").snapshot().permissions[0]?.id,
		current.permissions[0]?.id,
	);
	await runtime.stopDlc(active.attemptId);
	await running;
	// 最新の要求で同じ履歴を選び直した場合は、正常に閲覧できる。
	await host.receive({
		type: "dlc/attempt",
		requestId: "latest-history",
		intentId,
		attemptId: historyId,
	});
	assert.equal(runtime.scope("dlc").snapshot().sessionId, historySessionId);
});
