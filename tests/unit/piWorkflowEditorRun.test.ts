// 初回送信前の承認と、エディタ個別停止が既存の会話 UI に接続されることを確認する。
import { realpath } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { piHarness } from "./piHarness";
import type { PiSession } from "../../src/extension/backends/pi/PiRuntime";

/** 実在する作業ディレクトリだけを使い、モデルとファイル操作は模擬する。 */
async function fixture() {
	const h = piHarness();
	const root = await realpath(process.cwd());
	h.factory.mockResolvedValue({ session: h.runtime, cwd: root });
	h.runtime.workflow = vi.fn<NonNullable<PiSession["workflow"]>>(
		async (_request, signal, authorize) => {
			await authorize({ title: "Workflow read" }, signal);
			return "done";
		},
	);
	await h.controller.connect();
	return {
		...h,
		root,
		request: { root, file: "test.toml", text: "fixture" },
	};
}
it("親への送信前でも既存の承認ボタンで Workflow を開始できる", async () => {
	const h = await fixture();
	try {
		const done = h.controller.workflow(
			h.request,
			new AbortController().signal,
		);
		await vi.waitFor(() =>
			expect(h.controller.snapshot().permissions).toHaveLength(1),
		);
		const state = h.controller.snapshot();
		expect(state.runId).toBeTruthy();
		await h.controller.receive({
			type: "permission/respond",
			requestId: "workflow-approve",
			sessionId: state.sessionId,
			runId: state.runId,
			permissionId: state.permissions[0]!.id,
			optionId: "accept",
		});
		await expect(done).resolves.toBe("done");
		expect(h.runtime.prompt).not.toHaveBeenCalled();
	} finally {
		await h.controller.dispose();
	}
});
it("個別停止は承認待ちを解消し、別ルートの実行は拒否する", async () => {
	const h = await fixture();
	try {
		await expect(
			h.controller.workflow(
				{ ...h.request, root: `${h.root}-other` },
				new AbortController().signal,
			),
		).rejects.toThrow("同じワークスペース");
		const abort = new AbortController();
		const done = h.controller.workflow(h.request, abort.signal);
		const rejected = expect(done).rejects.toThrow();
		await vi.waitFor(() =>
			expect(h.controller.snapshot().permissions).toHaveLength(1),
		);
		abort.abort();
		await rejected;
		expect(h.controller.snapshot().permissions).toHaveLength(0);
	} finally {
		await h.controller.dispose();
	}
});
