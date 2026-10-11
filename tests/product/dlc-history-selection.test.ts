// Host・保存・Pi の会話処理に本番の実装を使い、遅い履歴取得による現在の実行表示の上書きを検出する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { IntentRepository } from "../../apps/vscode-nerita/src/extension/dlc/IntentRepository";
import { dlcHostFixture } from "../support/dlcHost";
import { until } from "../support/pi";

void test("履歴 A の取得中に実行中 B を選ぶと、遅れた A の応答後も B の会話と承認・停止対象を表示する", async (t) => {
	const { f, runtime, host, intentId, action } = await dlcHostFixture(t);
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
