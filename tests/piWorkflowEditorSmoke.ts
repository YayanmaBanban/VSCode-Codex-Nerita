// 親に送信していない実 SDK セッションから、承認 UI と Workflow 実行を接続する。
import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
	createPiRuntime,
	type PiRuntimeOptions,
	type PiRuntimeSession,
} from "../src/extension/backends/pi/PiRuntime";
import { PiSessionController } from "../src/extension/backends/pi/PiSessionController";

/** 実モデルの代わりに既存のローカル HTTP フィクスチャを使う。 */
export async function piWorkflowEditorSmoke(
	options: PiRuntimeOptions,
	text: string,
) {
	let runtime: PiRuntimeSession | undefined;
	const controller = new PiSessionController(async (signal, authorize) => {
		runtime = await createPiRuntime({
			...options,
			signal,
			authorize,
			ephemeral: true,
		});
		return { session: runtime, cwd: options.cwd };
	});
	const seen = new Set<string>();
	let approvals = 0;
	const unsubscribe = controller.subscribe(() => {
		queueMicrotask(() => {
			const state = controller.snapshot();
			for (const permission of state.permissions) {
				if (seen.has(permission.id)) {
					continue;
				}
				seen.add(permission.id);
				approvals++;
				void controller.receive({
					type: "permission/respond",
					requestId: randomUUID(),
					sessionId: state.sessionId!,
					runId: state.runId!,
					permissionId: permission.id,
					optionId: "accept",
				});
			}
		});
	});
	try {
		await controller.connect();
		const request = {
			root: await realpath(options.cwd),
			file: "test.toml",
			text,
		};
		await assert.rejects(
			controller.workflow({ ...request, text: "stale" }, options.signal),
			/保存内容/,
		);
		assert.equal(runtime!.jobs!.list().length, 0);
		await controller.workflow(request, options.signal);
		assert.equal(runtime!.jobs!.list().length, 5);
		assert.ok(
			runtime!.jobs!.list().every((job) => job.status === "completed"),
		);
		assert.ok(approvals >= 4);
		assert.equal(controller.snapshot().messages.length, 0);
		assert.equal(controller.snapshot().agents.length, 5);
	} finally {
		unsubscribe();
		await controller.dispose();
	}
}
