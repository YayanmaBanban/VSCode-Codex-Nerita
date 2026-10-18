// 管理画面と同じ保存経路を通し、接続済み Pi の実際の子モデル要求まで検証する。
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { AgentManagerStore } from "../../apps/vscode-nerita/src/extension/agentManager/AgentManagerStore";
import { readPiAgents } from "../../apps/vscode-nerita/src/extension/agentManager/PiAgentSettings";
import { readWorkspaceFile } from "../../apps/vscode-nerita/src/extension/agentManager/WorkspaceFiles";
import type { AgentEdit, PiDefaults } from "@nerita/shared/agentManager/config";
import { piFixture, send, finished, permission } from "../support/pi";
import { createPiRuntime } from "../../apps/vscode-nerita/src/extension/backends/pi/PiRuntime";
import { loadPiSdk } from "../../apps/vscode-nerita/src/extension/backends/pi/PiSdk";
import { readPiSubagentConfiguration } from "../../apps/vscode-nerita/src/extension/backends/pi/PiSubagentSettings";
import { PiWorkflowChildren } from "../../apps/vscode-nerita/src/extension/backends/pi/workflows/PiWorkflowChildren";
import { validateWorkflow } from "@nerita/shared/workflows/definition";

void test("保存した Pi の定義・個別モデル・推論・無効化を再接続せず子へ反映する", async (t) => {
	const f = await savedAgentFixture(t);
	await verifyIndividualSettings(f);
	await verifyDisabledAndLimit(f);
	await verifyDefaultsAndResume(f);
});

void test("Pi のワークフローにも保存したモデル・推論上限・起動上限を適用する", async (t) => {
	const f = await savedAgentFixture(t);
	await f.saveDefaults({
		defaultModel: "local/child-model",
		defaultThinking: "high",
		maxThinking: "low",
		maxSubagentSpawnsPerSession: 1,
	});
	const signal = new AbortController().signal;
	const runtime = await createPiRuntime({
		extensionPath: process.env.NERITA_TEST_EXTENSION!,
		cwd: f.cwd,
		agentDir: f.agentDir,
		preferredModel: { provider: "local", model: "test-model" },
		signal,
		workspaceRoots: [f.cwd],
		workspaceTrusted: true,
		trustStore: f.trust,
		executor: null,
		authorize: () => Promise.resolve(signal),
	});
	t.after(() => runtime.close());
	const sdk = await loadPiSdk(process.env.NERITA_TEST_EXTENSION!);
	const configuration = await readPiSubagentConfiguration(
		sdk,
		f.cwd,
		f.agentDir,
		true,
		[],
	);
	const workflow = validateWorkflow({
		version: 1,
		name: "saved",
		outputs: ["second"],
		steps: [
			{ id: "first", agent: "worker", task: "最初の作業" },
			{
				id: "second",
				agent: "worker",
				task: "次の作業",
				depends_on: ["first"],
			},
		],
	});
	const group = new PiWorkflowChildren(
		workflow,
		configuration.definitions,
		runtime.model,
		runtime.children,
		runtime.agentViews!,
		runtime.jobs!,
		runtime.accessPolicy,
		f.cwd,
		() => Promise.resolve(signal),
		"workflow",
		signal,
	);
	t.after(() => group.close());
	f.model.replies.push("ワークフローの子の回答");
	const result = await group.launch(
		"first",
		{ agent: "worker", task: "最初の作業" },
		signal,
	);
	assert.equal(result.ok, true);
	assert.deepEqual(modelRequest.parse(JSON.parse(f.model.requests[0]!)), {
		model: "child-model",
		reasoning_effort: "low",
	});
	await assert.rejects(
		group.launch("second", { agent: "worker", task: "次の作業" }, signal),
		/起動上限/,
	);
	assert.equal(f.model.requests.length, 1);
});

/** 親と子で異なるローカルモデルを登録し、接続後に管理画面と同じ経路で定義を追加する。 */
async function savedAgentFixture(t: TestContext) {
	const f = await piFixture(t);
	await writeFile(
		join(f.agentDir, "models.json"),
		JSON.stringify({
			providers: {
				local: {
					baseUrl: f.model.url,
					api: "openai-completions",
					apiKey: "local-test-key",
					models: ["test-model", "child-model"].map((id) => ({
						id,
						reasoning: id === "child-model",
						input: ["text"],
						contextWindow: 100000,
						maxTokens: 128,
					})),
				},
			},
		}),
	);
	const store = new AgentManagerStore(
		f.cwd,
		async () =>
			readPiAgents(
				process.env.NERITA_TEST_EXTENSION!,
				f.cwd,
				true,
				await readWorkspaceFile(f.cwd, ".pi/settings.json"),
			),
		() => [
			{
				value: "local/child-model",
				name: "Child",
				efforts: ["low", "high"],
			},
		],
	);
	const controller = f.controller();
	await controller.connect();
	await store.save({
		type: "createAgent",
		backend: "pi",
		id: 1,
		workspace: "test",
		generation: (await store.read()).generation,
		filename: "worker",
		edit: {
			definition: {
				name: "worker",
				description: "保存後に追加した担当",
				prompt: "saved-runtime-instruction",
			},
		},
	});
	/** 各保存時に世代を取得し、実際の競合検証と書込みを通す。 */
	const saveAgent = async (edit: AgentEdit) =>
		store.save({
			type: "agent",
			id: 2,
			workspace: "test",
			generation: (await store.read()).generation,
			agentId: "pi:worker",
			edit,
		});
	/** 個別設定とは別の保存要求で、実際の共通設定を更新する。 */
	const saveDefaults = async (defaults: PiDefaults) =>
		store.save({
			type: "defaults",
			id: 3,
			workspace: "test",
			generation: (await store.read()).generation,
			defaults,
		});
	return {
		...f,
		controllerFactory: f.controller,
		controller,
		saveAgent,
		saveDefaults,
	};
}
type Fixture = Awaited<ReturnType<typeof savedAgentFixture>>;
const modelRequest = z.object({
	model: z.string(),
	reasoning_effort: z.string(),
});

/** SDK の子が送ったモデル要求で、保存した指示と推論の上限を確認する。 */
async function verifyIndividualSettings(f: Fixture) {
	await f.saveAgent({ model: "local/child-model", thinking: "high" });
	await f.saveDefaults({
		maxThinking: "low",
		maxSubagentSpawnsPerSession: 1,
	});
	f.model.replies.push(
		{
			name: "subagent",
			arguments: { agent: "worker", task: "保存した設定で実行" },
		},
		"子の回答",
		"親の回答",
	);
	await send(f.controller, "担当へ委譲する");
	await permission(f.controller, "accept");
	const state = await finished(f.controller);
	assert.equal(state.agents[0]?.status, "completed", JSON.stringify(state));
	assert.match(f.model.requests[0]!, /保存後に追加した担当/);
	assert.deepEqual(modelRequest.parse(JSON.parse(f.model.requests[1]!)), {
		model: "child-model",
		reasoning_effort: "low",
	});
	assert.match(f.model.requests[1]!, /saved-runtime-instruction/);
}

/** 無効化と起動上限は子のネットワーク要求より前に拒否する。 */
async function verifyDisabledAndLimit(f: Fixture) {
	await f.saveAgent({ disabled: true });
	f.model.replies.push(
		{
			name: "subagent",
			arguments: { agent: "worker", task: "無効化を確認" },
		},
		"親の回答",
	);
	await send(f.controller, "無効な担当への委譲");
	await finished(f.controller);
	assert.match(f.model.requests.at(-1)!, /無効/);
	assert.equal(
		f.model.requests.length,
		5,
		"無効な子へのモデル要求を送らない",
	);
	await f.saveAgent({});
	f.model.replies.push(
		{
			name: "subagent",
			arguments: { agent: "worker", task: "上限を確認" },
		},
		"親の回答",
	);
	await send(f.controller, "再度委譲");
	await permission(f.controller, "accept");
	await finished(f.controller);
	assert.match(f.model.requests.at(-1)!, /起動上限/);
	assert.equal(
		f.model.requests.length,
		7,
		"起動回数の上限を超えた子へ要求を送らない",
	);
}

/** 未指定の個別値は保存済み既定値を使い、会話の再開でも累積上限を保持する。 */
async function verifyDefaultsAndResume(f: Fixture) {
	await f.saveDefaults({
		defaultModel: "local/child-model",
		defaultThinking: "high",
		maxThinking: "low",
		maxSubagentSpawnsPerSession: 2,
	});
	f.model.replies.push(
		{
			name: "subagent",
			arguments: { agent: "worker", task: "個別指定なしの既定値" },
		},
		"子の回答",
		"親の回答",
	);
	await send(f.controller, "既定値で委譲");
	await permission(f.controller, "accept");
	await finished(f.controller);
	assert.deepEqual(modelRequest.parse(JSON.parse(f.model.requests[8]!)), {
		model: "child-model",
		reasoning_effort: "low",
	});
	const sessionId = f.controller.snapshot().sessionId;
	await f.controller.dispose();
	const resumed = f.controllerFactory();
	await resumed.connect();
	await resumed.receive({ type: "session/list", requestId: "list" });
	await resumed.receive({
		type: "session/load",
		requestId: "reload",
		sessionId,
	});
	assert.equal(resumed.snapshot().sessionId, sessionId);
	f.model.replies.push(
		{
			name: "subagent",
			arguments: { agent: "worker", task: "再開しても上限を保持" },
		},
		"親の回答",
	);
	await send(resumed, "再開した会話で委譲");
	await permission(resumed, "accept");
	await finished(resumed);
	assert.equal(
		f.model.requests.length,
		12,
		"会話を再開しても起動上限をリセットしない",
	);
	assert.match(f.model.requests.at(-1)!, /起動上限/);
}
