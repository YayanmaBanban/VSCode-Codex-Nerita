// 同梱 SDK の OAuth と本番カタログ取得を使い、期限・取消し・認証変更を区別する。
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { OpenAIModelCatalogService } from "../../apps/vscode-nerita/src/extension/backends/pi/openai/OpenAIModelCatalogService";
import { PiModelCatalogService } from "../../apps/vscode-nerita/src/extension/backends/pi/PiModelCatalogService";
import { piFixture } from "../support/pi";

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
	const session = { model: publicModel } as unknown as AgentSession;
	const catalog = new PiModelCatalogService(models, session, fetch, {
		openai: { createCatalog: () => reader },
	});
	assert.deepEqual(
		catalog.available(available),
		available,
		"未取得時は SDK 候補を暫定表示する",
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
	const sdk = (await import(
		pathToFileURL(
			join(process.env.NERITA_TEST_EXTENSION!, "dist/runtime/pi.mjs"),
		).href
	)) as typeof PiSdk;
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
