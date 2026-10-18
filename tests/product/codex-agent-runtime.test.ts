// 配布対象の Codex 本体で、保存したカスタム定義からの子起動を確認する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { z } from "zod";
import { AgentManagerStore } from "../../apps/vscode-nerita/src/extension/agentManager/AgentManagerStore";
import { responsesServer } from "../support/responsesServer";

void test("Codex 本体が管理画面で保存した定義・モデル・推論を使って子を起動する", async (t) => {
	const root = await mkdtemp(
		join(process.env.NERITA_TEST_ROOT!, "native-codex-"),
	);
	const home = join(root, "home");
	await mkdir(home);
	let parentCalls = 0;
	const model = await responsesServer((request) => {
		if (request.model === "gpt-6-luna") {
			return "子の回答";
		}
		parentCalls++;
		if (parentCalls === 1) {
			return {
				name: "spawn_agent",
				namespace: "collaboration",
				arguments: {
					agent_type: "saved-worker",
					task_name: "saved_worker",
					message: "定義を使って応答する",
				},
			};
		}
		if (parentCalls === 2) {
			return {
				name: "wait_agent",
				namespace: "collaboration",
				arguments: { timeout_ms: 10000 },
			};
		}
		return "親の回答";
	});
	t.after(() => model.close());
	await saveCodexSettings(root, home, model.url);
	const result = await executeCodex(root, home);
	const child = model.requests.find(
		(request) => request.model === "gpt-6-luna",
	);
	assert.ok(
		child,
		JSON.stringify({
			models: model.requests.map((request) => request.model),
			result,
		}),
	);
	assert.equal(
		z.object({ effort: z.string() }).parse(child.reasoning).effort,
		"high",
	);
	assert.match(JSON.stringify(child), /native-saved-agent-instruction/);
});

/** 管理画面の保存と、隔離したローカルプロバイダーの設定を用意する。 */
async function saveCodexSettings(root: string, home: string, url: string) {
	const store = new AgentManagerStore(
		root,
		() => Promise.reject(new Error("Pi は使用しない")),
		() => [{ value: "gpt-6-luna", name: "Child", efforts: ["high"] }],
		() => "codex",
	);
	await store.save({
		type: "createAgent",
		backend: "codex",
		id: 1,
		workspace: "test",
		generation: (await store.read()).generation,
		filename: "saved-worker",
		edit: {
			definition: {
				name: "saved-worker",
				description: "保存した担当",
				prompt: "native-saved-agent-instruction",
			},
			model: "gpt-6-luna",
			reasoningEffort: "high",
		},
	});
	await writeFile(
		join(home, "config.toml"),
		[
			'model = "gpt-6.1-sol"',
			'model_provider = "fixture"',
			'approval_policy = "never"',
			"[features]",
			"multi_agent = true",
			`[projects.${JSON.stringify(root)}]`,
			'trust_level = "trusted"',
			"[model_providers.fixture]",
			'name = "fixture"',
			`base_url = ${JSON.stringify(url)}`,
			'wire_api = "responses"',
			"requires_openai_auth = false",
			"request_max_retries = 0",
			"stream_max_retries = 0",
		].join("\n"),
	);
}

/** 対話入力を閉じ、実際の同梱バイナリーの終了を待つ。 */
function executeCodex(root: string, home: string) {
	const require = createRequire(
		join(
			process.env.NERITA_TEST_REPO_ROOT!,
			"apps/vscode-nerita/package.json",
		),
	);
	const binary = join(
		dirname(require.resolve("@openai/codex/package.json")),
		"..",
		"codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
	);
	return new Promise<{ stdout: string; stderr: string }>(
		(resolve, reject) => {
			const child = execFile(
				binary,
				[
					"exec",
					"--json",
					"--skip-git-repo-check",
					"保存した担当へ委譲する",
				],
				{
					cwd: root,
					windowsHide: true,
					timeout: 30000,
					env: {
						...process.env,
						CODEX_HOME: home,
						OPENAI_API_KEY: "",
						CODEX_API_KEY: "",
					},
				},
				(error, stdout, stderr) => {
					if (error) {
						reject(new Error(error.message, { cause: error }));
					} else {
						resolve({ stdout, stderr });
					}
				},
			);
			child.stdin?.end();
		},
	);
}
