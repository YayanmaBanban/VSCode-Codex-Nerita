// 同梱 SDK の OAuth と本番カタログ取得を使い、期限・取消し・認証変更を区別する。
import { loadPiSdk } from "../../apps/vscode-nerita/src/extension/backends/pi/PiSdk";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { OpenAIModelCatalogService } from "../../apps/vscode-nerita/src/extension/backends/pi/openai/OpenAIModelCatalogService";
import { PiModelCatalogService } from "../../apps/vscode-nerita/src/extension/backends/pi/PiModelCatalogService";
import { readPiAgentModels } from "../../apps/vscode-nerita/src/extension/backends/pi/PiAgentModels";
import { piFixture, send, finished } from "../support/pi";
import { inspect } from "node:util";

for (const scenario of [
	{ status: 401, code: "token_revoked", kind: "revoked" },
	{ status: 401, code: "unknown", kind: "reauthenticate" },
	{ status: 403, code: "insufficient_permissions", kind: "forbidden" },
	{ status: 503, code: "unavailable", kind: "unavailable" },
] as const) {
	void test(`OAuth カタログの ${scenario.status}/${scenario.code} を分類し、認証拒否では成功キャッシュも無効にする`, async (t) => {
		const models = await catalogModels(t);
		const publicModel = models
			.getAvailableSnapshot()
			.find((model) => model.provider === "openai")!;
		let denied = false;
		const reader = new OpenAIModelCatalogService(models, () =>
			Promise.resolve(
				denied
					? Response.json(
							{
								error: {
									code: scenario.code,
									message: "fixture-private-access",
								},
							},
							{ status: scenario.status },
						)
					: Response.json({ data: [{ id: publicModel.id }] }),
			),
		);
		const signal = new AbortController().signal;
		assert.equal((await reader.read(signal))?.length, 1);
		denied = true;
		const deniedResult = await reader.read(signal);
		assert.equal(reader.failure?.kind, scenario.kind);
		assert.ok(!inspect(reader.failure).includes("fixture-private"));
		assert.equal(deniedResult === null, scenario.status !== 503);
		denied = false;
		assert.equal((await reader.read(signal))?.length, 1);
		assert.equal(
			reader.failure,
			undefined,
			"再認証後の成功には過去の失敗を残さない",
		);
	});
}

void test("公開 API の data 一覧をチャットと管理画面で共有し、未掲載モデルを送信前から除く", async (t) => {
	const models = await catalogModels(t);
	const sdk = await loadPiSdk(process.env.NERITA_TEST_EXTENSION!);
	const available = models
		.getAvailableSnapshot()
		.filter((model) => model.provider === "openai");
	const publicModel = available[0]!;
	let unavailable = false;
	const request: typeof fetch = () =>
		Promise.resolve(
			unavailable
				? new Response(null, { status: 503 })
				: Response.json({
						object: "list",
						data: [{ id: publicModel.id, object: "model" }],
					}),
		);
	const catalog = new PiModelCatalogService(
		models,
		{ model: publicModel },
		request,
	);
	assert.deepEqual(
		catalog.available(available),
		[],
		"OAuth 未確認時に SDK 全候補を表示しない",
	);
	await catalog.refresh("openai", new AbortController().signal);
	assert.deepEqual(catalog.available(available), [publicModel]);
	const manager = await readPiAgentModels(
		models,
		(model) => sdk.getSupportedThinkingLevels(model),
		new AbortController().signal,
		request,
	);
	assert.deepEqual(
		manager.filter((model) => model.value.startsWith("openai/")),
		[
			{
				value: `openai/${publicModel.id}`,
				name: `openai / ${publicModel.name}`,
				efforts: sdk.getSupportedThinkingLevels(publicModel),
			},
		],
	);
	unavailable = true;
	await catalog.refresh("openai", new AbortController().signal);
	assert.deepEqual(
		catalog.available(available),
		[publicModel],
		"再取得失敗でも成功済み候補を保持する",
	);
});

void test("Pi の送信後もモデル候補を保持し、推論は Codex と同じ表示名で公開する", async (t) => {
	const f = await piFixture(t);
	await writeFile(
		join(f.agentDir, "models.json"),
		JSON.stringify({
			providers: {
				local: {
					baseUrl: f.model.url,
					api: "openai-completions",
					apiKey: "local-test-key",
					models: [
						{
							id: "test-model",
							reasoning: true,
							thinkingLevelMap: { off: null, minimal: null },
							input: ["text"],
							contextWindow: 1000000,
							maxTokens: 128,
						},
					],
				},
			},
		}),
	);
	const controller = f.controller();
	await controller.connect();
	await controller.receive({
		type: "config/set",
		requestId: "catalog-reasoning",
		sessionId: controller.snapshot().sessionId!,
		configId: "reasoning_effort",
		value: "low",
	});
	const options = controller.snapshot().configOptions;
	assert.equal(controller.snapshot().connection, "ready");
	const thinking = options.find(
		(option) => option.id === "reasoning_effort",
	)!;
	assert.ok(thinking.options.length > 0);
	assert.ok(thinking.options.every((option) => /^[A-Z]/.test(option.name)));
	assert.equal(thinking.currentLabel, "Low");
	assert.equal(
		thinking.options.find((option) => option.value === "medium")?.name,
		"Medium",
	);
	const manager = controller.agentModels();
	assert.deepEqual(
		manager.find((model) => model.value === "local/test-model")?.efforts,
		thinking.options.map((option) => option.value),
		"同じモデルの管理画面とチャットの推論候補を一致させる",
	);
	assert.equal(
		thinking.options.some((option) => option.value === "off"),
		false,
	);
	f.model.replies.push("回答");
	await send(controller, "モデル候補を保持");
	assert.equal((await finished(controller)).run, "completed");
	assert.deepEqual(controller.snapshot().configOptions, options);
	assert.deepEqual(controller.agentModels(), manager);
});

void test("管理画面はライブカタログの公開順で絞り、OAuth の非公開・未掲載モデルを表示しない", async (t) => {
	const models = await catalogModels(t);
	const sdk = await loadPiSdk(process.env.NERITA_TEST_EXTENSION!);
	const available = models
		.getAvailableSnapshot()
		.filter((model) => model.provider === "openai");
	assert.ok(available.length > 2);
	const [first, second, hidden] = available;
	const options = await readPiAgentModels(
		models,
		(model) => sdk.getSupportedThinkingLevels(model),
		new AbortController().signal,
		() =>
			Promise.resolve(
				Response.json({
					models: [
						{
							slug: second!.id,
							display_name: "公開モデル B",
							visibility: "list",
						},
						{
							slug: first!.id,
							display_name: "公開モデル A",
							visibility: "list",
						},
						{
							slug: hidden!.id,
							display_name: "非公開モデル",
							visibility: "hide",
						},
					],
				}),
			),
	);
	assert.deepEqual(
		options
			.filter((model) => model.value.startsWith("openai/"))
			.map((model) => model.value),
		[`openai/${second!.id}`, `openai/${first!.id}`],
	);
	assert.deepEqual(
		options.find((model) => model.value === `openai/${first!.id}`)?.efforts,
		sdk.getSupportedThinkingLevels(first!),
	);
});

void test("管理画面の OAuth カタログ取得失敗で SDK 全モデルへ戻さず、他プロバイダーは保持する", async (t) => {
	const models = await catalogModels(t);
	const sdk = await loadPiSdk(process.env.NERITA_TEST_EXTENSION!);
	const options = await readPiAgentModels(
		models,
		(model) => sdk.getSupportedThinkingLevels(model),
		new AbortController().signal,
		() => Promise.resolve(new Response(null, { status: 503 })),
	);
	assert.equal(
		options.some((model) => model.value.startsWith("openai/")),
		false,
	);
	assert.ok(options.some((model) => model.value === "local/test-model"));
});

void test(
	"内部取得期限では成功カタログを保持し、呼出し元の取消しと認証変更では流用しない",
	verifyCatalogTimeout,
);

/** 認証は一時領域の SDK に任せ、HTTP 応答だけを成功・期限切れへ切り替える。 */
async function verifyCatalogTimeout(t: TestContext) {
	const models = await catalogModels(t);
	const available = models
		.getAvailableSnapshot()
		.filter((model) => model.provider === "openai");
	assert.ok(available.length > 1, "SDK の OAuth モデル候補を使う");
	const publicModel = available[0]!;
	let requests = 0;
	const reader = new OpenAIModelCatalogService(models, (_input, init) => {
		requests++;
		if (requests === 1) {
			return Promise.resolve(
				Response.json({
					models: [
						{
							slug: publicModel.id,
							display_name: "公開モデル",
							visibility: "list",
						},
					],
				}),
			);
		}
		if (requests === 3) {
			return Promise.resolve(Response.json({ models: [] }));
		}
		return waitForCancellation(init!.signal!);
	});
	// カタログの接続境界では参照中モデルだけを使い、会話の起動を代替する。
	const session = { model: publicModel };
	const catalog = new PiModelCatalogService(models, session, fetch, {
		openai: { createCatalog: () => reader },
	});
	assert.deepEqual(
		catalog.available(available),
		[],
		"未取得時に OAuth 用の未確認モデルを表示しない",
	);
	const caller = new AbortController();
	await catalog.refresh("openai", caller.signal);
	assert.deepEqual(
		catalog.available(available).map((model) => model.id),
		[publicModel.id],
	);
	await catalog.refresh("openai", caller.signal);
	assert.deepEqual(
		catalog.available(available).map((model) => model.id),
		[publicModel.id],
		"内部期限でも非公開候補を再表示しない",
	);
	assert.equal(caller.signal.aborted, false);
	assert.equal(
		catalog.failure("openai")?.kind,
		"network",
		"内部期限を認証失効と区別する",
	);
	const cancelled = new AbortController();
	cancelled.abort();
	assert.equal(await reader.read(cancelled.signal), null);
	await catalog.refresh("openai", caller.signal);
	assert.deepEqual(
		catalog.available(available),
		[],
		"取得に成功した空一覧では候補を SDK 全体へ戻さない",
	);
	await models.logout("openai");
	assert.equal(
		await reader.read(caller.signal),
		null,
		"認証変更後は旧アカウントのカタログを返さない",
	);
}

/** 専用 OAuth ファイルと同梱 SDK の候補を使い、既存アカウントへ触れない。 */
async function catalogModels(t: TestContext) {
	const f = await piFixture(t);
	const authPath = join(f.agentDir, "auth.json");
	await writeFile(
		authPath,
		JSON.stringify({
			openai: {
				type: "oauth",
				access: "catalog-fixture",
				refresh: "fixture-refresh",
				expires: Date.now() + 3600000,
			},
		}),
	);
	const sdk = await loadPiSdk(process.env.NERITA_TEST_EXTENSION!);
	return sdk.ModelRuntime.create({
		authPath,
		modelsPath: join(f.agentDir, "models.json"),
		allowModelNetwork: false,
	});
}

/** 実際の内部期限または呼出し元の中止が発火するまで HTTP 応答を待つ。 */
function waitForCancellation(signal: AbortSignal): Promise<Response> {
	return new Promise((_resolve, reject) => {
		const abort = () => reject(new Error("request cancelled"));
		if (signal.aborted) {
			abort();
			return;
		}
		signal.addEventListener("abort", abort, { once: true });
	});
}
