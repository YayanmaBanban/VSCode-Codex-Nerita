// 管理画面の保存形式から Pi SDK のツール実行・レビュー推論までを実際の経路で検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { defaultAutoReview } from "@nerita/shared/agentManager/autoReview";
import { autoReviewStore } from "../../apps/vscode-nerita/src/extension/security/AutoReviewStore";
import { AgentManagerStore } from "../../apps/vscode-nerita/src/extension/agentManager/AgentManagerStore";
import { readPiAgents } from "../../apps/vscode-nerita/src/extension/agentManager/PiAgentSettings";
import { piFixture, send, finished, until, permission } from "../support/pi";
import { restoredState } from "../support/restoredState";
import type { PiSessionController } from "../../apps/vscode-nerita/src/extension/backends/pi/PiSessionController";
import type { PiReviewHistory } from "../../apps/vscode-nerita/src/extension/backends/pi/PiReviewHistory";

void test("審査中のセッションを開き直すと中断として復元し再審査しない", async (t) => {
	const f = await piFixture(t);
	let reviews: PiReviewHistory | undefined;
	const controller = f.controller((runtime) => {
		reviews = runtime.reviews;
	});
	await controller.connect();
	f.model.replies.push("準備完了");
	await send(controller, "待機してください");
	await finished(controller);
	assert.ok(reviews);
	reviews.publish({
		id: "interrupted-review",
		time: Date.now(),
		tool: "write",
		status: "reviewing",
		reason: "審査中",
		model: "local/test-model",
		durationMs: 0,
		action: { tool: "write", cwd: f.cwd, path: "package.json" },
	});
	const sessionId = controller.snapshot().sessionId!;
	await controller.dispose();
	const restored = await restoredState(f, sessionId);
	const review = restored.tools.find(
		(tool) => tool.id === "autoApprovalReview:interrupted-review",
	);
	assert.ok(review);
	assert.equal(review.status, "cancelled");
	const output = z
		.object({ review: z.object({ status: z.string() }) })
		.parse(review.rawOutput);
	assert.equal(output.review.status, "aborted");
	assert.equal(f.model.requests.length, 1);
});

void test("管理画面で保存した設定に従い通常ファイルの作成でモデル審査と手動承認を省略する", async (t) => {
	const f = await piFixture(t);
	const manager = new AgentManagerStore(
		f.cwd,
		() =>
			readPiAgents(
				process.env.NERITA_TEST_EXTENSION!,
				f.cwd,
				true,
				undefined,
			),
		() => [{ value: "local/test-model", name: "Test", efforts: ["low"] }],
		() => "pi",
	);
	const state = await manager.read();
	await manager.save({
		type: "autoReview",
		backend: "pi",
		id: 1,
		workspace: "fixture",
		generation: state.generation,
		config: {
			...defaultAutoReview(),
			mode: "auto",
			model: "local/test-model",
		},
	});
	assert.equal((await manager.read()).autoReview.mode, "auto");
	f.model.replies.push(
		{
			name: "write",
			arguments: {
				path: "hello.bat",
				content: "@echo off\necho HelloWorld\n",
			},
		},
		"完了",
	);
	const controller = f.controller();
	await controller.connect();
	await send(controller, "HelloWorldを表示するバッチを作成");
	await finished(controller);
	assert.equal(
		await readFile(join(f.cwd, "hello.bat"), "utf8"),
		"@echo off\necho HelloWorld\n",
	);
	assert.equal(controller.snapshot().permissions.length, 0);
	assert.equal(f.model.requests.length, 2);
	assert.equal(
		controller
			.snapshot()
			.tools.some((tool) => tool.title === "Guardian Review"),
		false,
	);
});

void test("会話中のツール引数からも環境変数の値を送信しない", async (t) => {
	const f = await piFixture(t);
	await autoReviewStore.save(f.cwd, {
		...defaultAutoReview(),
		mode: "auto",
		model: "local/test-model",
		thinking: "off",
	});
	f.model.replies.push(
		{
			name: "write",
			arguments: {
				path: "note.txt",
				content: "note",
				env: { TOKEN: "withheld-env-value" },
			},
		},
		{ name: "write", arguments: { path: "package.json", content: "{}" } },
		JSON.stringify({
			outcome: "allow",
			risk: "low",
			authorization: "high",
			reason: "検証用判定",
		}),
		"終了",
	);
	const controller = f.controller();
	await controller.connect();
	await send(controller, "検証用の設定を作成");
	await finished(controller);
	assert.equal(f.model.requests.length, 4);
	assert.equal(f.model.requests[2]!.includes("withheld-env-value"), false);
	assert.equal(await readFile(join(f.cwd, "package.json"), "utf8"), "{}");
});

/** 別プロセスで保存履歴を開き、審査を再実行せず同じカードへ復元することを確認する。 */
async function verifyGuardianHistory(
	f: Awaited<ReturnType<typeof piFixture>>,
	controller: PiSessionController,
	status: string,
) {
	const state = controller.snapshot();
	const reviews = state.tools.filter(
		(tool) => tool.title === "Guardian Review",
	);
	assert.equal(reviews.length, 2);
	const schema = z.object({
		review: z.object({
			model: z.string(),
			rationale: z.string(),
			source: z.enum(["model", "shared", "prefetch"]),
			reusedFrom: z.string().nullable(),
			prefetched: z.boolean(),
			metrics: z.object({
				modelCalls: z.number(),
				prefetches: z.number(),
				requests: z.number(),
			}),
		}),
		action: z.object({ path: z.string() }),
	});
	const parsed = reviews.map((tool) => ({
		tool,
		output: schema.parse(tool.rawOutput),
	}));
	const model = parsed.find((item) => item.output.review.source === "model");
	const reused = parsed.find((item) => item.output.review.source !== "model");
	assert.ok(model);
	assert.ok(reused);
	assert.equal(
		parsed.filter((item) => item.output.review.prefetched).length,
		1,
	);
	assert.equal(
		model.tool.id,
		`autoApprovalReview:${reused.output.review.reusedFrom}`,
	);
	const { output } = reused;
	assert.equal(output.review.model, "local/test-model");
	assert.equal(output.review.rationale, "検証用判定");
	assert.equal(output.review.metrics.modelCalls, 1);
	assert.equal(output.review.metrics.prefetches, 1);
	assert.equal(output.review.metrics.requests, 1);
	assert.equal(output.action.path, join(f.cwd, "package.json"));
	const requests = f.model.requests.length;
	await controller.dispose();
	const restored = await restoredState(f, state.sessionId!);
	const history = restored.tools.filter(
		(tool) => tool.title === "Guardian Review",
	);
	assert.equal(history.length, 2);
	for (const review of reviews) {
		const restoredReview = history.find((tool) => tool.id === review.id);
		assert.ok(restoredReview);
		assert.equal(restoredReview.status, status);
		assert.deepEqual(restoredReview.rawOutput, review.rawOutput);
	}
	assert.equal(f.model.requests.length, requests);
}

for (const outcome of ["allow", "deny", "ask"] as const) {
	void test(`選択したレビューモデルの ${outcome} を Pi の実行許可へ反映する`, async (t) => {
		const f = await piFixture(t);
		await autoReviewStore.save(f.cwd, {
			...defaultAutoReview(),
			mode: "auto",
			model: "local/test-model",
			thinking: "off",
		});
		f.model.replies.push(
			{
				name: "write",
				arguments: {
					path: "package.json",
					content: '{"private":true}',
				},
			},
			JSON.stringify({
				outcome,
				risk: "low",
				authorization: "high",
				reason: "検証用判定",
			}),
			"終了",
		);
		const controller = f.controller();
		await controller.connect();
		await send(controller, "package.jsonを作成");
		if (outcome === "ask") {
			await until(() => controller.snapshot().permissions.length === 1);
			await assert.rejects(readFile(join(f.cwd, "package.json")), {
				code: "ENOENT",
			});
			await permission(controller, "decline");
		}
		await finished(controller);
		if (outcome === "allow") {
			assert.equal(
				await readFile(join(f.cwd, "package.json"), "utf8"),
				'{"private":true}',
			);
		} else {
			await assert.rejects(readFile(join(f.cwd, "package.json")), {
				code: "ENOENT",
			});
		}
		assert.equal(f.model.requests.length, 3);
		const reviewRequest = z
			.object({
				tools: z.array(z.unknown()).optional(),
				messages: z.array(z.unknown()),
			})
			.parse(JSON.parse(f.model.requests[1]!));
		assert.equal(reviewRequest.tools?.length ?? 0, 0);
		await verifyGuardianHistory(
			f,
			controller,
			outcome === "deny" ? "failed" : "completed",
		);
		assert.ok(
			JSON.stringify(reviewRequest.messages).includes(
				"package.jsonを作成",
			),
		);
	});
}

void test("子 Runtime も親の設定とユーザー依頼を使って審査する", async (t) => {
	const f = await piFixture(t);
	await mkdir(join(f.agentDir, "agents"));
	await writeFile(
		join(f.agentDir, "agents/worker.md"),
		"---\nname: worker\ndescription: 作業担当\ntools: read, write\n---\n指定された作業を実施する。\n",
	);
	await autoReviewStore.save(f.cwd, {
		...defaultAutoReview(),
		mode: "auto",
		model: "local/test-model",
		thinking: "off",
	});
	const allow = JSON.stringify({
		outcome: "allow",
		risk: "low",
		authorization: "high",
		reason: "検証用判定",
	});
	f.model.replies.push(
		{
			name: "subagent",
			arguments: {
				agent: "worker",
				task: "package.jsonを作成",
				context: "fork",
			},
		},
		allow,
		{
			name: "write",
			arguments: { path: "package.json", content: '{"private":true}' },
		},
		allow,
		"子の回答",
		"親の回答",
	);
	const controller = f.controller();
	await controller.connect();
	await send(controller, "親から依頼したプロジェクト設定を子に作成させる");
	await finished(controller);
	assert.equal(
		await readFile(join(f.cwd, "package.json"), "utf8"),
		'{"private":true}',
	);
	assert.equal(controller.snapshot().permissions.length, 0);
	assert.equal(f.model.requests.length, 6);
	assert.ok(
		f.model.requests[3]!.includes(
			"親から依頼したプロジェクト設定を子に作成させる",
		),
	);
});
