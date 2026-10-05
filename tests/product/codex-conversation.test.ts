// UI の送信・設定・停止要求を子プロセスとの JSONL 通信で処理し、共有状態への反映を確認する。

import { type TestContext, test } from "node:test";

import assert from "node:assert/strict";

import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import * as vscode from "vscode";
import { registerSandboxSetup } from "../../apps/vscode-nerita/src/extension/backends/codex/settings/sandboxSetup";
import { codexFixture } from "../support/codex";
import { until } from "../support/pi";
import type { CodexSessionController } from "../../apps/vscode-nerita/src/extension/backends/codex/CodexSessionController";

void test(
	"Sandbox の開始受付を完了と扱わず、完了通知・失敗・接続取消しを区別する",
	verifySandboxSetupNotifications,
);

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

void test(
	"Codex の設定を次の要求と再接続へ反映し、追加指示・計画・差分・停止を届ける",
	verifyCodexConfigAndRun,
);

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

void test(
	"コンテキスト圧縮の開始・完了通知で同じカードの状態を更新する",
	verifyCompactionNotifications,
);

/** 開始と完了を実際の通知経路に流し、同じ項目 ID のカードが重複せず更新されることを確認する。 */
async function verifyCompactionNotifications(t: TestContext) {
	const f = await codexFixture(t);
	const controller = f.controller();
	await controller.connect();
	await action(controller, "prompt/send", { text: "開始" });
	const threadId = controller.snapshot().sessionId;
	f.notify("turn/started", {
		threadId,
		turn: { id: "turn-1", status: "inProgress", items: [] },
	});
	const params = {
		threadId,
		turnId: "turn-1",
		item: { id: "compact", type: "contextCompaction" },
	};
	f.notify("item/started", params);
	await until(() =>
		controller.snapshot().tools.some((tool) => tool.id === "compact"),
	);
	assert.equal(
		controller.snapshot().tools.find((tool) => tool.id === "compact")!
			.status,
		"in_progress",
	);
	f.notify("item/completed", params);
	await until(
		() =>
			controller.snapshot().tools.find((tool) => tool.id === "compact")
				?.status === "completed",
	);
	assert.equal(
		controller.snapshot().tools.filter((tool) => tool.id === "compact")
			.length,
		1,
	);
}

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

/** 開始受付と完了通知を区別し、失敗と接続破棄でも待機を解除する。 */
async function verifySandboxSetupNotifications(t: TestContext) {
	const f = await codexFixture(t);
	const { command, info, errors, subscriptions } = prepareSandboxSetupUi(
		f,
		t,
	);
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
	assert.equal(
		info.length,
		1,
		"成功したセットアップの完了通知だけを表示する",
	);
	assert.match(info[0]!, /完了/);
	assert.equal(errors.length, 2);
	assert.match(errors[0]!, /setup failed/);
	assert.match(errors[1]!, /終了/);
}

/** 再接続へモデル設定を引き継ぎ、追加指示と停止を現在のターンへ届ける。 */
async function verifyCodexConfigAndRun(t: TestContext) {
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
		"終了済みターンの計画カードを実行中にしない",
	);
	await verifyCodexReconnection(f, controller, threadId, turnId);
}

/** セットアップの通知とコマンドを記録し、テスト終了時に登録を回収する。 */
function prepareSandboxSetupUi(
	f: Awaited<ReturnType<typeof codexFixture>>,
	t: TestContext,
) {
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
	return { command, info, errors, subscriptions };
}

/** 再接続後のモデル設定を検査し、古いターンの通知が反映されないことを確認する。 */
async function verifyCodexReconnection(
	f: Awaited<ReturnType<typeof codexFixture>>,
	controller: ReturnType<
		Awaited<ReturnType<typeof codexFixture>>["controller"]
	>,
	threadId: string | null,
	turnId: string,
) {
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
		"終了済みターンの計画カードを実行中にしない",
	);
	assert.ok(JSON.stringify(restored.snapshot().tools).includes("新しい計画"));
	assert.ok(!JSON.stringify(restored.snapshot().tools).includes("古い計画"));
}
