// 承認の世代・取消・一回限りの適用をControllerの通信境界から検証する。
import { describe, expect, it } from "vitest";
import { piHarness } from "./piHarness";

/** 実行中のControllerと、実SDKに渡す承認コールバックを取得する。 */
async function setup() {
	const harness = piHarness();
	await harness.controller.connect();
	await harness.send();
	const authorize = harness.factory.mock.calls[0]![1];
	const respond = (optionId: string, changes = {}) => {
		const state = harness.controller.snapshot();
		return harness.controller.receive({
			type: "permission/respond",
			requestId: crypto.randomUUID(),
			sessionId: state.sessionId,
			runId: state.runId,
			permissionId: state.permissions[0]?.id,
			optionId,
			...changes,
		});
	};
	return { ...harness, authorize, respond };
}

describe("Pi approvals", () => {
	it("許可は一回だけで、古い回答と未知の選択肢を拒否する", async () => {
		const h = await setup();
		const first = h.authorize("write");
		const id = h.controller.snapshot().permissions[0]!.id;
		for (const changes of [
			{ runId: "old" },
			{ sessionId: "old" },
			{ optionId: "always" },
		]) {
			await h.respond("accept", changes);
			expect(h.controller.snapshot().permissions).toHaveLength(1);
		}
		await h.respond("accept");
		await first;
		const second = h.authorize("edit");
		const rejected = expect(second).rejects.toThrow("拒否");
		await h.respond("accept", { permissionId: id });
		expect(h.controller.snapshot().permissions).toHaveLength(1);
		await h.respond("decline");
		await rejected;
		expect(h.runtime.abort).not.toHaveBeenCalled();
		await h.controller.dispose();
	});

	for (const action of [
		"stop",
		"cancel",
		"invalidate",
		"dispose",
		"signal",
	] as const) {
		it(`承認待ちを${action}で解除し、許可済みにしない`, async () => {
			const h = await setup();
			const abort = new AbortController();
			const pending = h.authorize("powershell", abort.signal);
			const rejected = expect(pending).rejects.toThrow();
			if (action === "stop") {
				await h.stop();
			} else if (action === "cancel") {
				await h.respond("cancel");
			} else if (action === "invalidate") {
				h.controller.invalidate();
			} else if (action === "dispose") {
				await h.controller.dispose();
			} else {
				abort.abort();
			}
			await rejected;
			expect(h.controller.snapshot().permissions).toHaveLength(0);
			await h.controller.dispose();
		});
	}

	it("許可直後のStopでも実処理を許可しない", async () => {
		const h = await setup();
		const pending = h.authorize("write");
		const rejected = expect(pending).rejects.toThrow();
		const response = h.respond("accept");
		await h.stop();
		await response;
		await rejected;
		await h.controller.dispose();
	});

	it("切断したSDKの承認を次の会話へ持ち越さない", async () => {
		const h = await setup();
		h.complete();
		await Promise.resolve();
		await h.controller.connect();
		await h.send();
		await expect(h.authorize("old write")).rejects.toThrow("古いPi接続");
		expect(h.controller.snapshot().permissions).toHaveLength(0);
		await h.controller.dispose();
	});
});
