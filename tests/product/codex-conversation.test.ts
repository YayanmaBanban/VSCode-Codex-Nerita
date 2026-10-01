// UI の送信・設定・停止を実 JSONL 境界へ通し、共有状態への到達を確認する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import * as vscode from "vscode";
import { registerSandboxSetup } from "../../apps/vscode-nerita/src/extension/backends/codex/settings/sandboxSetup";
import { codexFixture } from "../support/codex";
import { until } from "../support/pi";
import type { CodexSessionController } from "../../apps/vscode-nerita/src/extension/backends/codex/CodexSessionController";

void test("Sandbox の開始受付を完了と扱わず、完了通知・失敗・接続取消しを区別する", async (t) => {
	const f = await codexFixture(t);
	let command!: () => Promise<void>;
	const info: string[] = [];
	const errors: string[] = [];
	const subscriptions: { dispose(): unknown }[] = [];
	Object.assign(vscode.workspace, {
		workspaceFolders: [{ uri: { scheme: "file", fsPath: f.cwd } }],
		isTrusted: true,
		getConfiguration: () => ({ get: () => "pi" }),
	});
	Object.assign(vscode.ProgressLocation, { Notification: 15 });
	Object.assign(vscode.commands, {
		registerCommand: (_name: string, callback: () => Promise<void>) => {
			command = callback;
			return { dispose() {} };
		},
	});
	Object.assign(vscode.window, {
		withProgress: (_options: unknown, task: () => Promise<void>) => task(),
		showInformationMessage: (message: string) => {
			info.push(message);
			return Promise.resolve();
		},
		showErrorMessage: (message: string) => {
			errors.push(message);
			return Promise.resolve();
		},
	});
	t.after(() => {
		for (const subscription of subscriptions) {
			subscription.dispose();
		}
		for (const boundary of [
			vscode.workspace,
			vscode.window,
			vscode.commands,
			vscode.ProgressLocation,
		]) {
			for (const key of Object.keys(boundary)) {
				Reflect.deleteProperty(boundary, key);
			}
		}
	});
	registerSandboxSetup({
		extensionUri: { fsPath: f.extensionPath },
		subscriptions,
	} as unknown as vscode.ExtensionContext);
	for (const result of ["success", "failure", "cancel"] as const) {
		const previous = f.requests.filter(
			(request) => request.method === "windowsSandbox/setupStart",
		).length;
		let settled = false;
		const running = command().finally(() => {
			settled = true;
		});
		try {
			await until(
				() =>
					f.requests.filter(
						(request) =>
							request.method === "windowsSandbox/setupStart",
					).length ===
					previous + 1,
				() => errors,
			);
			// 開始応答だけで終了する回帰を、完了通知のない観測期間で検出する。
			await setTimeout(100);
			assert.equal(
				settled,
				false,
				"開始受付だけで完了表示してはいけない",
			);
			if (result === "cancel") {
				subscriptions[0]!.dispose();
			} else {
				f.notify("windowsSandbox/setupCompleted", {
					mode: "elevated",
					success: result === "success",
					error: result === "failure" ? "setup failed" : null,
				});
			}
			await running;
		} finally {
			if (!settled) {
				subscriptions[0]!.dispose();
				await running;
			}
		}
	}
	assert.equal(info.length, 1);
	assert.match(info[0]!, /完了/);
	assert.equal(errors.length, 2);
	assert.match(errors[0]!, /setup failed/);
	assert.match(errors[1]!, /終了/);
});

/** 公開メッセージの現在の会話情報を埋めて操作する。 */
async function action(
	controller: CodexSessionController,
	type: string,
	fields: Record<string, unknown> = {},
) {
	await controller.receive({
		type,
		requestId: randomUUID(),
		sessionId: controller.snapshot().sessionId,
		runId: controller.snapshot().runId,
		...fields,
	});
}

void test("Codex の設定を次の要求と再接続へ反映し、追加指示・計画・差分・停止を届ける", async (t) => {
	const f = await codexFixture(t);
	const controller = f.controller();
	await controller.connect();
	assert.equal(
		controller.snapshot().connection,
		"ready",
		JSON.stringify(controller.snapshot()),
	);
	await action(controller, "config/set", {
		configId: "model",
		value: "model-b",
	});
	await action(controller, "config/set", {
		configId: "reasoning_effort",
		value: "high",
	});
	await action(controller, "prompt/send", { text: "最初の指示" });
	const start = f.requests.find((request) => request.method === "turn/start");
	assert.ok(start);
	assert.equal(start.params?.model, "model-b");
	assert.equal(start.params?.effort, "high");
	const threadId = controller.snapshot().sessionId;
	const turnId = "turn-1";
	f.notify("turn/started", {
		threadId,
		turn: { id: turnId, status: "inProgress", items: [] },
	});
	f.notify("turn/plan/updated", {
		threadId,
		turnId,
		plan: [{ step: "変更を確認する", status: "inProgress" }],
	});
	f.notify("turn/diff/updated", {
		threadId,
		turnId,
		diff: "diff --git a/a.ts b/a.ts\n+変更",
	});
	await until(
		() => controller.snapshot().tools.length === 2,
		() => controller.snapshot(),
	);
	const tools = controller.snapshot().tools;
	assert.ok(JSON.stringify(tools).includes("変更を確認する"));
	assert.ok(JSON.stringify(tools).includes("diff --git a/a.ts b/a.ts"));
	await action(controller, "prompt/send", { text: "追加指示" });
	const steer = f.requests.filter(
		(request) => request.method === "turn/steer",
	);
	assert.equal(steer.length, 1);
	assert.equal(steer[0]!.params?.expectedTurnId, turnId);
	assert.ok(JSON.stringify(steer[0]!.params?.input).includes("追加指示"));
	await action(controller, "prompt/cancel");
	await until(() =>
		f.requests.some((request) => request.method === "turn/interrupt"),
	);
	f.notify("turn/completed", {
		threadId,
		turn: { id: turnId, status: "interrupted", items: [] },
	});
	await until(
		() => controller.snapshot().run === "cancelled",
		() => controller.snapshot(),
	);
	assert.equal(controller.snapshot().tools.length, 2);
	assert.ok(
		controller
			.snapshot()
			.tools.every((tool) => tool.status !== "in_progress"),
	);
	await controller.dispose();
	const restored = f.controller();
	await restored.connect();
	assert.equal(restored.snapshot().connection, "ready");
	await action(restored, "prompt/send", { text: "再接続後" });
	const starts = f.requests.filter(
		(request) => request.method === "turn/start",
	);
	assert.equal(starts.length, 2);
	assert.equal(starts[1]!.params?.model, "model-b");
	assert.equal(starts[1]!.params?.effort, "high");
	f.notify("turn/plan/updated", {
		threadId: restored.snapshot().sessionId,
		turnId: "turn-2",
		plan: [{ step: "新しい計画", status: "completed" }],
	});
	f.notify("turn/diff/updated", {
		threadId: restored.snapshot().sessionId,
		turnId: "turn-2",
		diff: "diff --git a/b.ts b/b.ts\n+新しい変更",
	});
	f.notify("turn/plan/updated", {
		threadId,
		turnId,
		plan: [{ step: "古い計画", status: "inProgress" }],
	});
	f.notify("turn/completed", {
		threadId: restored.snapshot().sessionId,
		turn: { id: "turn-2", status: "completed", items: [] },
	});
	await until(() => restored.snapshot().run === "completed");
	assert.equal(restored.snapshot().tools.length, 2);
	assert.ok(
		restored.snapshot().tools.every((tool) => tool.status === "completed"),
	);
	assert.ok(JSON.stringify(restored.snapshot().tools).includes("新しい計画"));
	assert.ok(!JSON.stringify(restored.snapshot().tools).includes("古い計画"));
});

void test("Codex の追加指示が受付不明でも自動再送しない", async (t) => {
	const f = await codexFixture(t);
	f.state.failSteer = true;
	const controller = f.controller();
	await controller.connect();
	await action(controller, "prompt/send", { text: "開始" });
	f.notify("turn/started", {
		threadId: controller.snapshot().sessionId,
		turn: { id: "turn-1", status: "inProgress", items: [] },
	});
	await action(controller, "prompt/send", { text: "受付不明の追加" });
	assert.equal(
		f.requests.filter((request) => request.method === "turn/steer").length,
		1,
	);
	assert.equal(
		f.requests.filter((request) => request.method === "turn/start").length,
		1,
	);
	assert.ok(
		!controller
			.snapshot()
			.messages.some((message) => message.text === "受付不明の追加"),
	);
	f.disconnect();
	await until(() => controller.snapshot().connection === "error");
	assert.equal(controller.snapshot().run, "failed");
	await action(controller, "connection/retry");
	assert.equal(controller.snapshot().connection, "ready");
});

void test("Codex の認証中に接続を破棄した後、遅い成功通知で会話を開始しない", async (t) => {
	const f = await codexFixture(t);
	f.state.authenticated = false;
	const urls: string[] = [];
	const controller = f.controller({
		open: (url) => {
			urls.push(url);
			return Promise.resolve();
		},
		apiKey: () => undefined,
	});
	await controller.connect();
	assert.equal(controller.snapshot().connection, "auth-required");
	const login = action(controller, "auth/start", { methodId: "chatgpt" });
	await until(() => urls.length === 1);
	controller.invalidate();
	await login;
	await controller.connect();
	const revision = controller.snapshot().revision;
	f.notify("account/login/completed", { loginId: "login-1", success: true });
	f.notify("account/rateLimits/updated", { rateLimits: {} });
	await until(() => controller.snapshot().revision > revision);
	assert.equal(controller.snapshot().connection, "auth-required");
	assert.equal(
		f.requests.filter((request) => request.method === "thread/start")
			.length,
		0,
	);
});
