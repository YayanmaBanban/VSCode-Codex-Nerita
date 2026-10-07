// UI の送信・設定・停止要求を子プロセスとの JSONL 通信で処理し、共有状態への反映を確認する。

import { type TestContext, test } from "node:test";
import assert from "node:assert/strict";

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout } from "node:timers/promises";
import * as vscode from "vscode";
import { registerSandboxSetup } from "../../apps/vscode-nerita/src/extension/backends/codex/settings/sandboxSetup";
import { codexFixture, codexResponseGate, type Rpc } from "../support/codex";
import { until } from "../support/pi";
import type { CodexSessionController } from "../../apps/vscode-nerita/src/extension/backends/codex/CodexSessionController";
import { parseTurnEvent } from "../../apps/vscode-nerita/src/extension/backends/codex/items/turnEvents";
import type { ItemGuardianApprovalReviewStartedNotification } from "../../apps/vscode-nerita/src/extension/backends/codex/codex-app-server/v2/ItemGuardianApprovalReviewStartedNotification";
import type { ItemGuardianApprovalReviewCompletedNotification } from "../../apps/vscode-nerita/src/extension/backends/codex/codex-app-server/v2/ItemGuardianApprovalReviewCompletedNotification";

void test("活動通知の差分・計画・推論は、ターンへ適用する前に本文を検証する", () => {
	for (const [method, fields] of [
		["turn/diff/updated", { diff: 42 }],
		["turn/plan/updated", { plan: [{ status: "pending", step: 42 }] }],
		[
			"item/reasoning/summaryTextDelta",
			{ itemId: "item", summaryIndex: -1, delta: "text" },
		],
		["item/started", { item: { id: 42, type: "plan" } }],
		[
			"item/autoApprovalReview/started",
			{
				reviewId: 42,
				review: {
					status: "inProgress",
					riskLevel: null,
					userAuthorization: null,
					rationale: null,
				},
				action: {
					type: "requestPermissions",
					reason: null,
					permissions: {},
				},
			},
		],
		[
			"item/autoApprovalReview/completed",
			{
				reviewId: "review",
				review: {
					status: "inProgress",
					riskLevel: null,
					userAuthorization: null,
					rationale: null,
				},
				action: {
					type: "requestPermissions",
					reason: null,
					permissions: {},
				},
			},
		],
	] as const) {
		assert.throws(
			() =>
				parseTurnEvent({
					method,
					params: { threadId: "thread", turnId: "turn", ...fields },
				}),
			method,
		);
	}
	assert.deepEqual(
		parseTurnEvent({
			method: "turn/diff/updated",
			params: { threadId: "thread", turnId: "turn", diff: "diff" },
		}),
		{
			kind: "activity",
			threadId: "thread",
			turnId: "turn",
			update: {
				id: "turn:turn/diff/updated",
				kind: "diff",
				diff: "diff",
			},
		},
	);
});

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

void test("Codex の Plan を新規会話で実行してもモデル・推論と権限の詳細を引き継ぐ", async (t) => {
	const f = await codexFixture(t);
	const sandbox = {
		type: "workspaceWrite",
		writableRoots: [f.cwd],
		networkAccess: true,
		excludeTmpdirEnvVar: true,
		excludeSlashTmp: true,
	};
	let thread = 0;
	f.responses.set("thread/start", () => ({
		thread: { id: `plan-thread-${++thread}` },
		model: "model-a",
		cwd: f.cwd,
		reasoningEffort: "low",
		sandbox:
			thread === 1 ? sandbox : { type: "readOnly", networkAccess: false },
		approvalsReviewer: thread === 1 ? "auto_review" : "user",
	}));
	const controller = f.controller();
	await controller.connect();
	await action(controller, "config/set", {
		configId: "model",
		value: "model-b",
	});
	await action(controller, "config/set", {
		configId: "reasoning_effort",
		value: "high",
	});
	await action(controller, "prompt/send", { text: "/plan 計画する" });
	const originalThread = controller.snapshot().sessionId;
	f.notify("turn/completed", {
		threadId: originalThread,
		turn: {
			id: "turn-1",
			status: "completed",
			items: [{ id: "plan", type: "plan", text: "この計画を実装する" }],
		},
	});
	await until(() => controller.snapshot().planDecision !== null);

	await action(controller, "plan/decide", { action: "new" });
	const starts = f.requests.filter(
		(request) => request.method === "turn/start",
	);
	assert.equal(starts.length, 2);
	const implementing = starts[1]!.params!;
	assert.notEqual(implementing.threadId, originalThread);
	assert.equal(implementing.threadId, controller.snapshot().sessionId);
	assert.equal(implementing.model, "model-b");
	assert.equal(implementing.effort, "high");
	assert.equal(implementing.approvalsReviewer, "auto_review");
	assert.deepEqual(implementing.sandboxPolicy, sandbox);
	assert.deepEqual(implementing.collaborationMode, {
		mode: "default",
		settings: {
			model: "model-b",
			reasoning_effort: "high",
			developer_instructions: null,
		},
	});
	assert.match(JSON.stringify(implementing.input), /この計画を実装する/u);
	assert.equal(controller.snapshot().planDecision, null);
});

for (const disconnected of [false, true]) {
	void test(`Codex の Default への切替中は送信を止め、設定応答を同じ接続だけに反映する（切断=${disconnected}）`, (t) =>
		verifyCollaborationUpdate(t, disconnected));
}

/** 設定 RPC の待機中に操作を拒否し、切断後の新しい会話へ設定を反映しないことを確認する。 */
async function verifyCollaborationUpdate(
	t: TestContext,
	disconnected: boolean,
) {
	const f = await codexFixture(t);
	const controller = f.controller();
	await controller.connect();
	await action(controller, "prompt/send", { text: "/plan" });
	const threadId = controller.snapshot().sessionId;
	const gate = codexResponseGate();
	t.after(() => gate.release({}));
	let waiting = false;
	f.responses.set("thread/settings/update", () => {
		waiting = true;
		return gate.response;
	});
	const failures: string[] = [];
	t.after(
		controller.subscribe((event) => {
			if (event.type === "request/failed") {
				failures.push(event.requestId);
			}
		}),
	);
	const changing = action(controller, "config/set", {
		configId: "collaboration_mode",
		value: "default",
	});
	await until(() => waiting);
	assert.equal(controller.snapshot().configPending, true);
	await action(controller, "prompt/send", {
		text: "応答待ち",
		requestId: "pending-prompt",
	});
	assert.ok(failures.includes("pending-prompt"));
	assert.equal(
		f.requests.filter((request) => request.method === "turn/start").length,
		0,
	);

	if (disconnected) {
		controller.invalidate();
		await changing;
		await controller.connect();
		assert.notEqual(controller.snapshot().sessionId, threadId);
		await action(controller, "config/set", {
			configId: "collaboration_mode",
			value: "goal",
		});
	}
	gate.release({});
	await changing;
	f.notify("thread/name/updated", {
		threadId: controller.snapshot().sessionId,
		threadName: "設定応答後",
	});
	await until(() => controller.snapshot().sessionTitle === "設定応答後");
	assert.equal(controller.snapshot().configPending, false);
	assert.equal(
		controller
			.snapshot()
			.configOptions.find((option) => option.id === "collaboration_mode")
			?.currentValue,
		disconnected ? "goal" : "default",
	);
	assertDefaultModeRequest(f.requests, threadId);
	await action(controller, "prompt/send", { text: "応答後" });
	const start = f.requests.find(
		(request) => request.method === "turn/start",
	)!;
	assert.equal(start.params?.threadId, controller.snapshot().sessionId);
	assert.ok(
		JSON.stringify(start.params.input).includes(
			disconnected ? "/goal 応答後" : "応答後",
		),
	);
}

/** Default の更新は一度だけ送り、待機中の会話に現在のモデルと推論量を指定する。 */
function assertDefaultModeRequest(requests: Rpc[], threadId: string | null) {
	const updates = requests.filter(
		(request) => request.method === "thread/settings/update",
	);
	assert.equal(updates.length, 1);
	assert.deepEqual(updates[0]!.params, {
		threadId,
		collaborationMode: {
			mode: "default",
			settings: {
				model: "model-a",
				reasoning_effort: "low",
				developer_instructions: null,
			},
		},
	});
}

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

void test("Codex は開始応答前の子の活動と完了を待機し、対象ターンだけに反映して完了一覧で重複させない", async (t) => {
	const f = await codexFixture(t);
	const controller = f.controller();
	await controller.connect();
	const threadId = controller.snapshot().sessionId!;
	const gate = codexResponseGate();
	const reply = { turn: { id: "early-turn", status: "inProgress" } };
	t.after(() => gate.release(reply));
	let waiting = false;
	f.responses.set("turn/start", () => {
		waiting = true;
		return gate.response;
	});
	f.responses.set("thread/read", ({ params }) => ({
		thread: {
			id: params!.threadId,
			parentThreadId: threadId,
			cwd: f.cwd,
			preview: "子",
			updatedAt: 1,
			status: { type: "active" },
			turns: [],
		},
	}));
	const pending = action(controller, "prompt/send", { text: "子を開始" });
	await until(() => waiting);
	const item = {
		id: "child-start",
		type: "subAgentActivity",
		agentThreadId: "child",
		agentPath: "child",
		kind: "started",
	};
	f.notify("item/started", { threadId, turnId: "early-turn", item });
	f.notify("item/started", {
		threadId,
		turnId: "old-turn",
		item: { ...item, id: "old-child-start", agentThreadId: "old-child" },
	});
	const completed = {
		threadId,
		turn: { id: "early-turn", status: "completed", items: [item] },
	};
	f.notify("turn/completed", completed);
	// 同じ通知ストリームの後続通知を待ち、開始応答前の活動が届いたことを確認する。
	f.notify("thread/name/updated", { threadId, threadName: "開始応答待ち" });
	await until(() => controller.snapshot().sessionTitle === "開始応答待ち");
	assert.deepEqual(controller.snapshot().agents, []);
	assert.equal(controller.snapshot().run, "running");

	gate.release(reply);
	await pending;
	await until(() => controller.snapshot().agents.length === 1);
	assert.equal(controller.snapshot().run, "completed");
	assert.equal(controller.snapshot().agents[0]!.threadId, "child");
	assert.equal(controller.snapshot().sessionId, threadId);
	f.notify("turn/completed", completed);
	f.notify("thread/name/updated", { threadId, threadName: "完了通知の再送" });
	await until(() => controller.snapshot().sessionTitle === "完了通知の再送");
	assert.equal(controller.snapshot().run, "completed");
	assert.equal(controller.snapshot().agents.length, 1);
	assert.equal(controller.snapshot().agents[0]!.threadId, "child");
});

void test(
	"コンテキスト圧縮の開始・完了通知で同じカードの状態を更新する",
	verifyCompactionNotifications,
);

void test(
	"自動承認審査の開始・完了で独立したカードを更新し、遅い開始と重複完了を無視する",
	verifyApprovalReviewNotifications,
);

/** 通知経路を通して開始・完了と対象コマンドの状態を確認する。 */
async function verifyApprovalReviewNotifications(t: TestContext) {
	const f = await codexFixture(t);
	const controller = f.controller();
	await controller.connect();
	await action(controller, "prompt/send", { text: "開始" });
	const threadId = controller.snapshot().sessionId!;
	const params: ItemGuardianApprovalReviewStartedNotification = {
		threadId,
		turnId: "turn-1",
		startedAtMs: 1000,
		reviewId: "review-1",
		targetItemId: "command",
		review: {
			status: "inProgress",
			riskLevel: null,
			userAuthorization: null,
			rationale: null,
		},
		action: {
			type: "command",
			source: "shell",
			command: "pnpm.cmd --version",
			cwd: f.cwd,
		},
	};
	f.notify("item/started", {
		threadId,
		turnId: "turn-1",
		item: {
			id: "command",
			type: "commandExecution",
			command: "pnpm.cmd --version",
			cwd: f.cwd,
		},
	});
	f.notify("item/autoApprovalReview/started", params);
	await until(() => controller.snapshot().tools.length === 2);
	const started = controller
		.snapshot()
		.tools.find((tool) => tool.title === "Guardian Review")!;
	assert.equal(started.status, "in_progress");
	assert.equal(started.kind, "think");
	assert.deepEqual(started.rawOutput, {
		review: params.review,
		action: params.action,
	});
	const review: ItemGuardianApprovalReviewCompletedNotification["review"] = {
		status: "approved",
		riskLevel: "low",
		userAuthorization: "high",
		rationale: "バージョン確認のため承認しました。",
	};
	const completion: ItemGuardianApprovalReviewCompletedNotification = {
		...params,
		completedAtMs: 2000,
		decisionSource: "agent",
		review,
	};
	f.notify("item/autoApprovalReview/completed", completion);
	await until(
		() =>
			controller.snapshot().tools.find((tool) => tool.id === started.id)
				?.status === "completed",
	);
	const finished = controller
		.snapshot()
		.tools.find((tool) => tool.id === started.id)!;
	assert.equal(finished.order, started.order);
	assert.deepEqual(finished.rawOutput, { review, action: params.action });
	await verifyAdditionalApprovalReviews(
		f,
		controller,
		params,
		completion,
		started.id,
	);
}

/** 複数審査を保持し、完了済み審査と古いターンへの通知は現在の状態を変えない。 */
async function verifyAdditionalApprovalReviews(
	f: Awaited<ReturnType<typeof codexFixture>>,
	controller: CodexSessionController,
	params: ItemGuardianApprovalReviewStartedNotification,
	completion: ItemGuardianApprovalReviewCompletedNotification,
	reviewToolId: string,
) {
	f.notify("item/autoApprovalReview/started", {
		...params,
		reviewId: "review-2",
	});
	f.notify("item/autoApprovalReview/completed", {
		...completion,
		reviewId: "network-review",
		targetItemId: null,
		action: {
			type: "networkAccess",
			target: "example.com",
			host: "example.com",
			protocol: "https",
			port: 443,
		},
	});
	f.notify("item/autoApprovalReview/started", params);
	f.notify("item/autoApprovalReview/completed", {
		...completion,
		review: { ...completion.review, rationale: "重複通知" },
	});
	f.notify("item/autoApprovalReview/started", {
		...params,
		turnId: "old-turn",
		reviewId: "stale-review",
	});
	f.notify("thread/name/updated", {
		threadId: params.threadId,
		threadName: "審査通知の受信完了",
	});
	await until(
		() => controller.snapshot().sessionTitle === "審査通知の受信完了",
	);
	assert.equal(controller.snapshot().tools.length, 4);
	assert.deepEqual(
		controller.snapshot().tools.find((tool) => tool.id === reviewToolId)
			?.rawOutput,
		{ review: completion.review, action: params.action },
	);
	assert.equal(
		controller.snapshot().tools.find((tool) => tool.id === "command")
			?.status,
		"in_progress",
	);
	assert.equal(
		controller
			.snapshot()
			.tools.filter((tool) => tool.title === "Guardian Review").length,
		3,
	);
}

void test("自動承認審査の拒否・期限切れ・中断は対象操作と独立した失敗カードになる", async (t) => {
	const f = await codexFixture(t);
	const controller = f.controller();
	await controller.connect();
	await action(controller, "prompt/send", { text: "開始" });
	for (const status of ["denied", "timedOut", "aborted"]) {
		f.notify("item/autoApprovalReview/completed", {
			threadId: controller.snapshot().sessionId,
			turnId: "turn-1",
			reviewId: status,
			targetItemId: null,
			startedAtMs: 1000,
			completedAtMs: 2000,
			decisionSource: "agent",
			review: {
				status,
				riskLevel: null,
				userAuthorization: null,
				rationale: "審査を終了しました。",
			},
			action: {
				type: "requestPermissions",
				reason: null,
				permissions: {},
			},
		});
	}
	await until(() => controller.snapshot().tools.length === 3);
	assert.ok(
		controller.snapshot().tools.every((tool) => tool.status === "failed"),
	);
	assert.equal(controller.snapshot().run, "running");
});

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
	const { command, info, errors, subscriptions, setBackend } =
		prepareSandboxSetupUi(f, t);
	const initialRequests = f.requests.length;
	setBackend("pi");
	await command();
	assert.equal(
		f.requests.length,
		initialRequests,
		"PiではApp Serverを起動しない",
	);
	assert.equal(info.length, 0);
	setBackend("codex");
	for (const result of ["success", "failure", "cancel"] as const) {
		const previous = f.requests.filter(
			(request) => request.method === "windowsSandbox/setupStart",
		).length;
		const completion = { settled: false };
		const running = command().finally(() => {
			completion.settled = true;
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
				completion.settled,
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
			if (!completion.settled) {
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

/** 画像と速度設定に対応するモデル候補と、OS のファイル選択境界を用意する。 */
async function imageModelFixture(t: TestContext) {
	const f = await codexFixture(t);
	f.responses.set("model/list", () => ({
		nextCursor: null,
		data: ["model-a", "model-b"].map((model) => ({
			model,
			displayName: `候補 ${model}`,
			defaultReasoningEffort: "low",
			supportedReasoningEfforts: [
				{ reasoningEffort: "low", description: "通常" },
				{ reasoningEffort: "high", description: "詳細" },
			],
			inputModalities: model === "model-b" ? ["text", "image"] : ["text"],
			serviceTiers: [
				{ id: "priority", name: "Fast", description: "高速で実行" },
			],
		})),
	}));
	const image = join(f.cwd, "image.png");
	await writeFile(image, Buffer.from("iVBORw0KGgo=", "base64"));
	const controller = f.controller(undefined, {
		pick: () =>
			Promise.resolve([
				{
					id: "image",
					name: "image.png",
					uri: pathToFileURL(image).href,
				},
			]),
		open: () => Promise.resolve(),
	});
	return { ...f, controller, image };
}

void test("Codex の画像添付は選択モデルの能力に従い、Fast mode をターンへ反映して再接続へ持ち越さない", async (t) => {
	const f = await imageModelFixture(t);
	const { controller, image } = f;
	await controller.connect();
	assert.equal(controller.snapshot().attachmentsSupported, true);
	await action(controller, "attachment/add");
	await action(controller, "prompt/send", { text: "画像非対応モデル" });
	assert.equal(controller.snapshot().run, "failed");
	assert.equal(controller.snapshot().attachments.length, 1);
	assert.equal(
		f.requests.filter((request) => request.method === "turn/start").length,
		0,
	);
	await action(controller, "config/set", {
		configId: "model",
		value: "model-b",
	});
	await action(controller, "config/set", {
		configId: "reasoning_effort",
		value: "high",
	});
	await action(controller, "config/set", {
		configId: "fast-mode",
		value: "on",
	});
	await action(controller, "prompt/send", { text: "最初の指示" });
	const start = f.requests.find((request) => request.method === "turn/start");
	assert.ok(start);
	assert.equal(start.params?.model, "model-b");
	assert.equal(start.params.effort, "high");
	assert.equal(start.params.serviceTierForTurn, "priority");
	assert.ok(Array.isArray(start.params.input));
	assert.deepEqual(start.params.input[1], {
		type: "localImage",
		path: image,
	});
	assert.equal(controller.snapshot().attachments.length, 0);
	f.notify("turn/completed", {
		threadId: controller.snapshot().sessionId,
		turn: { id: "turn-1", status: "completed", items: [] },
	});
	await until(() => controller.snapshot().run === "completed");
	await controller.connect();
	await action(controller, "prompt/send", { text: "再接続後" });
	const starts = f.requests.filter(
		(request) => request.method === "turn/start",
	);
	assert.equal(starts.length, 2);
	assert.equal(starts[1]!.params?.model, "model-b");
	assert.equal(starts[1]!.params.effort, "high");
	assert.equal(starts[1]!.params.serviceTierForTurn, undefined);
});

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
	assert.equal(start.params.effort, "high");
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
	assert.ok(JSON.stringify(steer[0]!.params.input).includes("追加指示"));
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
	let backend = "codex";
	Object.assign(vscode.workspace, {
		workspaceFolders: [{ uri: { scheme: "file", fsPath: f.cwd } }],
		isTrusted: true,
		getConfiguration: () => ({ get: () => backend }),
	});
	Object.assign(vscode.ProgressLocation, { Notification: 15 });
	Object.assign(vscode.commands, {
		registerCommand: (name: string, callback: () => Promise<void>) => {
			assert.equal(name, "nerita.codex.setupWindowsSandbox");
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
	// VS Code の登録境界で利用するパスと購読管理だけを代替する。
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
	registerSandboxSetup({
		extensionUri: { fsPath: f.extensionPath },
		subscriptions,
	} as unknown as vscode.ExtensionContext);
	return {
		command,
		info,
		errors,
		subscriptions,
		setBackend: (value: string) => {
			backend = value;
		},
	};
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
	assert.equal(starts[1]!.params.effort, "high");
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
