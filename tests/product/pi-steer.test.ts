// SDK の入力処理だけを保留し、完了・停止と競合した追加指示のキューと保存履歴を検証する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { HostMessage } from "@nerita/shared/messages";
import { piFixture, send, finished, permission, until } from "../support/pi";
import { restoredState } from "../support/restoredState";

for (const stop of [false, true]) {
	void test(`Pi の遅い追加指示を${stop ? "停止" : "完了"}後に受理・保存せず、次の実行へ持ち越さない`, (t) =>
		verifyLateSteer(t, stop));
}

/** 実際の SDK へ渡す直前に入力を遅延させ、製品の終了処理との競合を起こす。 */
async function verifyLateSteer(t: TestContext, stop: boolean) {
	const f = await piFixture(t);
	let release!: () => void;
	let steering = false;
	const delayed = new Promise<void>((resolve) => {
		release = resolve;
	});
	let streaming = () => false;
	const controller = f.controller((runtime) => {
		const steer = runtime.steer.bind(runtime);
		streaming = () => runtime.isStreaming;
		runtime.steer = async (text) => {
			steering = true;
			await delayed;
			return steer(text);
		};
	});
	const events: HostMessage[] = [];
	controller.subscribe((event) => events.push(event));
	await controller.connect();
	f.model.replies.push(
		{ name: "write", arguments: { path: "old.txt", content: "old" } },
		"旧実行の回答",
	);
	await send(controller, "元の指示");
	await until(() => controller.snapshot().permissions.length === 1);
	const late = await send(controller, "遅い追加指示");
	try {
		await until(() => steering);
		const duplicate = await send(controller, "処理中の二重送信");
		assert.ok(
			events.some(
				(event) =>
					event.type === "request/failed" &&
					event.requestId === duplicate.requestId,
			),
		);
		if (stop) {
			const state = controller.snapshot();
			assert.ok(isNonEmptyString(state.sessionId));
			assert.ok(isNonEmptyString(state.runId));
			await controller.receive({
				type: "prompt/cancel",
				requestId: "stop",
				sessionId: state.sessionId,
				runId: state.runId,
			});
		} else {
			await permission(controller, "accept");
		}
		await until(
			() => !streaming(),
			() => controller.snapshot(),
		);
	} finally {
		release();
	}
	const state = await finished(controller);
	assert.equal(
		state.run,
		stop ? "cancelled" : "completed",
		JSON.stringify(state),
	);
	assert.ok(
		events.some(
			(event) =>
				event.type === "request/failed" &&
				event.requestId === late.requestId,
		),
	);
	assert.ok(
		!events.some(
			(event) =>
				event.type === "prompt/accepted" &&
				event.requestId === late.requestId,
		),
	);
	assert.ok(!JSON.stringify(state.messages).includes("遅い追加指示"));
	await verifyNextPrompt(f, controller);
}

/** 拒否した入力が次の要求や保存・別接続の復元に混ざらないことを確認する。 */
async function verifyNextPrompt(
	f: Awaited<ReturnType<typeof piFixture>>,
	controller: ReturnType<Awaited<ReturnType<typeof piFixture>>["controller"]>,
) {
	// Stop では元の回答が消費されないため、モデルに用意した未使用の応答を取り除く。
	f.model.replies.length = 0;
	f.model.replies.push("次の実行の回答");
	await send(controller, "次の通常送信");
	const next = await finished(controller);
	assert.equal(next.run, "completed", JSON.stringify(next));
	assert.equal(next.messages.at(-1)?.text, "次の実行の回答");
	assert.ok(!f.model.requests.at(-1)!.includes("遅い追加指示"));
	await controller.dispose();
	const restored = await restoredState(f, next.sessionId!);
	assert.ok(!JSON.stringify(restored.messages).includes("遅い追加指示"));
	assert.equal(restored.messages.at(-1)?.text, "次の実行の回答");
}
