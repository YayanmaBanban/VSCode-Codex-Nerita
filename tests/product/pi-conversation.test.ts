// モデル変更・追加指示を SDK 本体の次の HTTP 要求へ反映し、保存した選択を再起動で使う。

import { type TestContext, test } from "node:test";

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { setImmediate } from "node:timers/promises";
import {
	piFixture,
	send,
	finished,
	permission,
	until,
	sessionFiles,
} from "../support/pi";
import type { PiModelSelection } from "../../apps/vscode-nerita/src/extension/backends/pi/PiRuntime";

void test(
	"利用枠を実サービス経路で取得し、プロバイダー変更と接続破棄後の遅い応答を公開しない",
	verifyPiQuotaLifetime,
);

void test(
	"保存した会話の原文とハンドオフを参照し、要約失敗では親へ送信しない",
	verifyPiSessionReferences,
);

void test("起動中に無効化した Pi 接続の遅い完了を公開せず、次の接続だけへ送信する", async (t) => {
	const f = await piFixture(t);
	let created!: () => void;
	let release!: () => void;
	const createdPromise = new Promise<void>((resolve) => {
		created = resolve;
	});
	const releasePromise = new Promise<void>((resolve) => {
		release = resolve;
	});
	const controller = f.controller(async () => {
		created();
		await releasePromise;
	});
	// 途中のアサーションに失敗しても、接続の回収待ちを残さない。
	const opening = controller.connect();
	try {
		await createdPromise;
		controller.invalidate();
		assert.equal(controller.snapshot().connection, "disconnected");
	} finally {
		release();
		await opening;
	}
	assert.equal(controller.snapshot().connection, "disconnected");
	assert.equal(controller.snapshot().sessionId, null);
	assert.deepEqual(controller.snapshot().messages, []);
	await controller.receive({ type: "connection/retry", requestId: "retry" });
	assert.equal(controller.snapshot().connection, "ready");
	f.model.replies.push("新しい接続の回答");
	await send(controller, "有効な接続だけを使用");
	assert.equal((await finished(controller)).run, "completed");
	assert.equal(f.model.requests.length, 1);
	assert.equal(
		controller.snapshot().messages.at(-1)?.text,
		"新しい接続の回答",
	);
});

void test(
	"Pi のモデル・推論変更と追加指示を送信し、保存した選択を新しい接続で使う",
	verifyPiModelPersistence,
);

/** プロバイダー変更と接続破棄後の遅い利用枠応答を公開しない。 */
async function verifyPiQuotaLifetime(t: TestContext) {
	const f = await piFixture(t);
	await prepareQuotaModel(f);
	const pending: {
		signal: AbortSignal;
		reply: (response: Response) => void;
	}[] = [];
	f.options.request = createQuotaRequest(pending);
	const controller = f.controller();
	try {
		await controller.connect();
		assert.equal(controller.snapshot().connection, "ready");
		const model = controller
			.snapshot()
			.configOptions.find((option) => option.id === "provider")
			?.options.find((option) => option.value === "openai")?.value;
		assert.ok(model, "実 SDK の OpenAI モデル一覧を使う");
		const select = (value: string, requestId: string) =>
			controller.receive({
				type: "config/set",
				requestId,
				sessionId: controller.snapshot().sessionId,
				configId: "provider",
				value,
			});
		const quota = (remaining: number) =>
			Response.json({
				rate_limit: {
					primary_window: {
						used_percent: 100 - remaining,
						limit_window_seconds: 18000,
					},
				},
			});
		await select(model, "quota-first");
		await until(
			() => pending.length === 1,
			() => controller.snapshot(),
		);
		pending[0]!.reply(quota(80));
		await until(
			() => controller.snapshot().quota?.[0]?.remaining === 80,
			() => controller.snapshot(),
		);
		await select("local", "quota-clear");
		assert.equal(controller.snapshot().quota, null);
		await select(model, "quota-delayed");
		await until(() => pending.length === 2);
		await select("local", "quota-switch");
		assert.ok(pending[1]!.signal.aborted);
		assert.equal(controller.snapshot().quota, null);
		await select(model, "quota-newer");
		await until(() => pending.length === 3);
		pending[2]!.reply(quota(60));
		await until(() => controller.snapshot().quota?.[0]?.remaining === 60);
		pending[1]!.reply(quota(10));
		// 応答本文の非同期読取りまで進め、旧取得元の値が公開されないか観測する。
		await setImmediate();
		await setImmediate();
		assert.equal(controller.snapshot().quota?.[0]?.remaining, 60);
		await select("local", "quota-before-disconnect");
		await select(model, "quota-disconnect");
		await until(() => pending.length === 4);
		controller.invalidate();
		assert.ok(pending[3]!.signal.aborted);
		pending[3]!.reply(quota(5));
		await controller.connect();
		assert.equal(controller.snapshot().connection, "ready");
		assert.equal(controller.snapshot().quota, null);
	} finally {
		for (const request of pending) {
			request.reply(Response.json({}));
		}
	}
}

/** カタログと保留中の利用枠応答をモデル境界で再現する。 */
function createQuotaRequest(
	pending: { signal: AbortSignal; reply: (response: Response) => void }[],
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
	return async (input, init) => {
		const url = input instanceof Request ? input.url : String(input);
		if (url.startsWith("https://api.openai.com/v1/models?")) {
			return Response.json({
				models: [
					{
						slug: "quota-model",
						display_name: "Quota fixture",
						visibility: "list",
					},
				],
			});
		}
		assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
		assert.equal(init?.redirect, "error");
		assert.ok(init?.signal);
		return new Promise<Response>((reply) =>
			pending.push({ signal: init.signal!, reply }),
		);
	};
}

/** 原文とハンドオフの参照後も履歴を保持し、要約失敗時は親へ送信しない。 */
async function verifyPiSessionReferences(t: TestContext) {
	const f = await piFixture(t);
	const controller = f.controller();
	await controller.connect();
	f.model.replies.push("参照元だけの回答");
	await send(controller, "参照元の作業記録");
	const source = await finished(controller);
	const [saved] = await sessionFiles(f.cwd);
	assert.ok(saved);
	await controller.receive({
		type: "session/new",
		requestId: "new-reference",
	});
	const targetId = controller.snapshot().sessionId;
	f.model.replies.push("原文を確認しました");
	await controller.receive({
		type: "prompt/send",
		requestId: "transcript",
		sessionId: targetId,
		text: "原文を参照",
		sessionReferences: [
			{ sessionId: source.sessionId, mode: "transcript" },
		],
	});
	assert.equal((await finished(controller)).run, "completed");
	assert.ok(f.model.requests[1]!.includes("参照元の作業記録"));
	assert.ok(
		f.model.requests[1]!.includes(`referenced_session:${source.sessionId}`),
	);
	assert.ok(f.model.requests[1]!.includes("untrusted"));
	await controller.receive({ type: "session/new", requestId: "new-handoff" });
	const handoffId = controller.snapshot().sessionId;
	f.model.replies.push("引継ぎ用の要約", "引継ぎを受領");
	await controller.receive({
		type: "prompt/send",
		requestId: "handoff",
		sessionId: handoffId,
		text: "続きの作業",
		sessionReferences: [{ sessionId: source.sessionId, mode: "handoff" }],
	});
	assert.equal((await finished(controller)).run, "completed");
	verifyHandoffIsolation(f);
	assert.ok(f.model.requests[3]!.includes("引継ぎ用の要約"));
	assert.ok(
		f.model.requests[3]!.includes(`referenced_handoff:${source.sessionId}`),
	);
	assert.ok(!f.model.requests[3]!.includes("参照元だけの回答"));
	const before = controller.snapshot().messages;
	f.model.replies.push({
		name: "write",
		arguments: { path: "forbidden.txt", content: "not a summary" },
	});
	await controller.receive({
		type: "prompt/send",
		requestId: "failed-handoff",
		sessionId: handoffId,
		text: "生成に失敗する参照",
		sessionReferences: [{ sessionId: source.sessionId, mode: "handoff" }],
	});
	const failed = await finished(controller);
	assert.match(failed.error ?? "", /ハンドオフ/);
	assert.deepEqual(failed.messages, before);
	assert.equal(
		f.model.requests.length,
		5,
		"要約失敗後に元履歴やツール結果を親へ送らない",
	);
	await assert.rejects(readFile(join(f.cwd, "forbidden.txt")), {
		code: "ENOENT",
	});
	assert.equal(await readFile(saved.path, "utf8"), saved.text);
}

/** 追加指示を受け付け、モデルと推論設定を保存して新しい接続で使う。 */
async function verifyPiModelPersistence(t: TestContext) {
	const f = await piFixture(t);
	await prepareConversationModels(f);
	const selection = join(f.root, "selection.json");
	f.options.saveModel = async (value) => {
		await writeFile(selection, JSON.stringify(value));
	};
	const controller = f.controller();
	await controller.connect();
	assert.equal(controller.snapshot().connection, "ready");
	assert.deepEqual(
		controller.snapshot().skills,
		[],
		"専用領域の外からスキルを継承しない",
	);
	for (const [configId, value] of [
		["model", "local/other-model"],
		["reasoning_effort", "high"],
	]) {
		await controller.receive({
			type: "config/set",
			requestId: configId,
			sessionId: controller.snapshot().sessionId,
			configId,
			value,
		});
	}
	f.model.replies.push(
		{
			name: "write",
			arguments: { path: "result.txt", content: "accepted" },
		},
		"追加入力を反映",
	);
	await send(controller, "作業を開始");
	await until(() => controller.snapshot().permissions.length === 1);
	await send(controller, "追加指示を含める");
	await permission(controller, "accept");
	const state = await finished(controller);
	assert.equal(state.run, "completed", JSON.stringify(state));
	assert.equal(await readFile(join(f.cwd, "result.txt"), "utf8"), "accepted");
	assert.equal(f.model.requests.length, 2);
	assert.ok(f.model.requests[1]!.includes("追加指示を含める"));
	const first = JSON.parse(f.model.requests[0]!) as Record<string, unknown>;
	assert.equal(first.model, "other-model");
	assert.equal(first.reasoning_effort, "high");
	await controller.dispose();
	const saved = JSON.parse(
		await readFile(selection, "utf8"),
	) as PiModelSelection;
	assert.deepEqual(saved, {
		provider: "local",
		model: "other-model",
		reasoning: "high",
	});
	f.options.preferredModel = saved;
	f.model.replies.push("再開後の返答");
	const restored = f.controller();
	await restored.connect();
	await send(restored, "新しい会話");
	assert.equal((await finished(restored)).run, "completed");
	const next = JSON.parse(f.model.requests[2]!) as Record<string, unknown>;
	assert.equal(next.model, "other-model");
	assert.equal(next.reasoning_effort, "high");
}

/** OAuth とカタログをローカル応答へ固定して利用枠の競合を再現する。 */
async function prepareQuotaModel(f: Awaited<ReturnType<typeof piFixture>>) {
	await writeFile(
		join(f.agentDir, "auth.json"),
		JSON.stringify({
			openai: {
				type: "oauth",
				access: "local-quota-token",
				refresh: "local-refresh-token",
				expires: Date.now() + 3600000,
			},
		}),
	);
	const configured = JSON.parse(
		await readFile(join(f.agentDir, "models.json"), "utf8"),
	) as { providers: Record<string, unknown> };
	configured.providers.openai = {
		baseUrl: "https://api.openai.com/v1",
		api: "openai-responses",
		models: [
			{
				id: "quota-model",
				reasoning: false,
				input: ["text"],
				contextWindow: 100000,
				maxTokens: 128,
			},
		],
	};
	await writeFile(
		join(f.agentDir, "models.json"),
		JSON.stringify(configured),
	);
}

/** 要約用の送信には副作用ツールを含めず、参照履歴を未信頼として扱う。 */
function verifyHandoffIsolation(f: Awaited<ReturnType<typeof piFixture>>) {
	const summary = JSON.parse(f.model.requests[2]!) as {
		tools?: unknown[];
		messages: unknown[];
	};
	assert.equal(
		summary.tools?.length ?? 0,
		0,
		"要約生成へ副作用ツールを渡さない",
	);
	assert.ok(JSON.stringify(summary.messages).includes("参照元の作業記録"));
	assert.ok(
		JSON.stringify(summary.messages).includes("untrusted_conversation"),
	);
}

/** モデル変更と推論設定の保存を同じローカルプロバイダーで検証する。 */
async function prepareConversationModels(
	f: Awaited<ReturnType<typeof piFixture>>,
) {
	await writeFile(
		join(f.agentDir, "models.json"),
		JSON.stringify({
			providers: {
				local: {
					baseUrl: f.model.url,
					api: "openai-completions",
					apiKey: "local-test-key",
					models: ["test-model", "other-model"].map((id) => ({
						id,
						reasoning: true,
						input: ["text"],
						contextWindow: 1000000,
						maxTokens: 128,
					})),
				},
			},
		}),
	);
}
