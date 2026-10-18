// 実際の保存と再読込みを通し、定義・権限・競合時のデータ保持を検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import * as vscode from "vscode";
import type { BackendId } from "@nerita/shared/backend";
import type { ManagerReply } from "@nerita/shared/agentManager/messages";
import { AgentManagerPanel } from "../../apps/vscode-nerita/src/extension/agentManager/AgentManagerPanel";
import { BackendRuntime } from "../../apps/vscode-nerita/src/extension/session/BackendRuntime";
import { piFixture, until } from "../support/pi";
import { codexFixture } from "../support/codex";
import { mkdtemp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { parse } from "smol-toml";
import { z } from "zod";
import { AgentManagerStore } from "../../apps/vscode-nerita/src/extension/agentManager/AgentManagerStore";
import { readPiAgents } from "../../apps/vscode-nerita/src/extension/agentManager/PiAgentSettings";
import { readWorkspaceFile } from "../../apps/vscode-nerita/src/extension/agentManager/WorkspaceFiles";
import { editCodexAgent } from "../../apps/vscode-nerita/src/extension/agentManager/CodexAgentEdit";
import { currentAgentModel } from "../../apps/vscode-nerita/src/extension/agentManager/AgentModelCatalog";
import { initialState } from "@nerita/shared/chatState";
import { defaultHandoffModel } from "@nerita/shared/agentManager/handoffModels";
import {
	defaultHandoff,
	handoffSchema,
	agentEditSchema,
	type AgentEdit,
} from "@nerita/shared/agentManager/config";

/** SDK のプロジェクト読込みと Host の保存を同じ一時ワークスペースへ接続する。 */
async function fixture() {
	const root = await mkdtemp(join(process.env.NERITA_TEST_ROOT!, "manager-"));
	const store = new AgentManagerStore(
		root,
		async () =>
			readPiAgents(
				process.env.NERITA_TEST_EXTENSION!,
				root,
				true,
				await readWorkspaceFile(root, ".pi/settings.json"),
			),
		() => [{ value: "test-model", name: "Test", efforts: ["low", "high"] }],
	);
	return { root, store };
}

void test("開いた管理画面を設定変更と新バックエンドの接続完了に追従させ、旧モデル候補を混ぜない", async (t) => {
	const pi = await piFixture(t);
	const codex = await codexFixture(t, pi.cwd);
	const settings = managerBackendSettings(pi.cwd);
	const runtime = new BackendRuntime(() =>
		settings.current() === "pi" ? pi.controller() : codex.controller(),
	);
	t.after(() => runtime.dispose());
	await runtime.receive({
		type: "connection/retry",
		requestId: "manager-connect",
	});
	const messages: ManagerReply[] = [];
	const panel = new AgentManagerPanel(
		{ uri: vscode.Uri.file(pi.cwd), name: "fixture", index: 0 },
		pi.cwd,
		{
			webview: {
				postMessage: (message: ManagerReply) => {
					messages.push(message);
					return Promise.resolve(true);
				},
			},
		},
		runtime,
		process.env.NERITA_TEST_EXTENSION!,
		() => Promise.resolve([]),
	);
	t.after(() => panel.close());
	panel.receive({ type: "ready" });
	await until(
		() => latestManagerState(messages)?.activeBackend === "pi",
		() => messages,
	);
	settings.switchTo("codex");
	await until(
		() => latestManagerState(messages)?.activeBackend === "codex",
		() => messages,
	);
	const switched = latestManagerState(messages)!;
	assert.deepEqual(
		switched.models.codex,
		[],
		"切替前の Pi の候補を Codex として公開しない",
	);
	await runtime.restart();
	await until(
		() =>
			latestManagerState(messages)?.currentEfforts?.codex?.includes(
				"high",
			) === true,
		() => messages,
	);
	const connected = latestManagerState(messages)!;
	assert.equal(connected.currentModels?.codex, "model-a");
	assert.deepEqual(connected.currentEfforts?.codex, ["low", "high"]);
	settings.switchTo("pi");
	await runtime.restart();
	await until(
		() =>
			latestManagerState(messages)?.currentModels?.pi ===
			"local/test-model",
		() => messages,
	);
	panel.close();
	assert.equal(settings.listeners(), 0, "パネルを閉じた後は設定を購読しない");
});

/** 切替前の状態や返信を拾わず、最後に公開された管理状態を検証する。 */
function latestManagerState(messages: ManagerReply[]) {
	return messages.filter((message) => message.type === "state").at(-1);
}

/** VS Code の設定通知だけを代替し、管理画面とバックエンドの処理は本番経路を使う。 */
function managerBackendSettings(cwd: string) {
	let backend: BackendId = "pi";
	const listeners = new Set<
		(event: vscode.ConfigurationChangeEvent) => void
	>();
	Object.assign(vscode.Uri, {
		file: (fsPath: string) => ({ fsPath, toString: () => fsPath }),
	});
	Object.assign(vscode.workspace, {
		isTrusted: true,
		getConfiguration: () => ({
			get: (key: string) => (key === "backend" ? backend : undefined),
		}),
		onDidChangeConfiguration: (
			listener: (event: vscode.ConfigurationChangeEvent) => void,
		) => {
			listeners.add(listener);
			return { dispose: () => listeners.delete(listener) };
		},
		workspaceFolders: [
			{ uri: vscode.Uri.file(cwd), name: "fixture", index: 0 },
		],
	});
	return {
		current: () => backend,
		listeners: () => listeners.size,
		switchTo: (value: BackendId) => {
			backend = value;
			for (const listener of listeners) {
				listener({
					affectsConfiguration: (section) =>
						section === "nerita.backend",
				});
			}
		},
	};
}

void test("現在モデルが一覧と異なる ID でもセッション自身の推論候補を管理画面へ渡す", () => {
	const state = initialState();
	state.configOptions = [
		{
			id: "model",
			name: "Model",
			currentValue: "session-alias",
			options: [],
		},
		{
			id: "reasoning_effort",
			name: "Reasoning",
			currentValue: "high",
			options: ["low", "high", "ultra"].map((value) => ({
				value,
				name: value,
			})),
		},
	];
	assert.deepEqual(currentAgentModel(state, "codex"), {
		currentModels: { codex: "session-alias" },
		currentEfforts: { codex: ["low", "high", "ultra"] },
	});
	assert.deepEqual(currentAgentModel(state, "pi").currentEfforts, {
		pi: ["low", "high"],
	});
});

void test("固定モデルの既定値は利用可能な GPT-6-Luna を優先し、存在しない値を作らない", () => {
	const models = [
		"anthropic/available-model",
		"openai/gpt-6-sol",
		"openai/gpt-6-luna",
	].map((value) => ({ value, name: value }));
	assert.equal(defaultHandoffModel("pi", models), "openai/gpt-6-luna");
	assert.equal(
		defaultHandoffModel("codex", [
			{ value: "gpt-6-sol", name: "Sol" },
			{ value: "gpt-6-luna", name: "Luna" },
		]),
		"gpt-6-luna",
	);
	assert.equal(
		defaultHandoffModel("pi", models.slice(0, 1)),
		"anthropic/available-model",
	);
	assert.equal(defaultHandoffModel("pi", []), undefined);
});

void test("Codex の定義・モデル・推論を保存し、未知の設定とコメントを保持する", async () => {
	const { root, store } = await fixture();
	await mkdir(join(root, ".codex/agents"), { recursive: true });
	const file = ".codex/agents/reviewer.toml";
	await writeFile(
		join(root, file),
		'# keep\nname = "reviewer"\ndescription = "old"\ndeveloper_instructions = """line one\nmodel = fake\n"""\n[custom]\nflag = true\n',
	);
	const state = await store.read();
	const edit: AgentEdit = {
		definition: {
			name: "renamed",
			description: "日本語の説明",
			prompt: '複数行\n"引用" と # を保持\n',
		},
		model: "test-model",
		reasoningEffort: "high",
	};
	await store.save({
		type: "agent",
		id: 1,
		workspace: "test",
		generation: state.generation,
		agentId: file,
		edit,
	});
	const saved = await readFile(join(root, file), "utf8");
	assert.match(saved, /# keep/);
	assert.deepEqual(parse(saved), {
		name: "renamed",
		description: "日本語の説明",
		developer_instructions: edit.definition!.prompt,
		model: "test-model",
		model_reasoning_effort: "high",
		custom: { flag: true },
	});
	assert.deepEqual(
		(await store.read()).agents.find((agent) => agent.backend === "codex")!
			.edit,
		edit,
	);
});

void test("Codex のモデル編集で既存の非対応項目やテーブルを変更せず、新たな権限指定は受理しない", () => {
	for (const text of [
		"approval_policy = { granular = { rules = true } }\n",
		"approval_policy.granular.rules = true\napproval_policy.granular.sandbox_approval = false\n",
		'["approval_policy"."granular"]\nrules = true\n[unrelated]\nvalue = 1\n',
	]) {
		const parsed = parse(editCodexAgent(text, { model: "test-model" }));
		assert.deepEqual(parsed, { model: "test-model", ...parse(text) });
	}
	assert.equal(
		agentEditSchema.safeParse({ sandboxMode: "workspace-write" }).success,
		false,
	);
});

void test("新規作成は再読込みでき、同名・既存ファイル・未信頼・古い世代・範囲外を拒否する", async () => {
	const { root, store } = await fixture();
	const request = {
		type: "createAgent" as const,
		backend: "codex" as const,
		id: 1,
		workspace: "test",
		generation: (await store.read()).generation,
		filename: "new-agent",
		edit: {
			definition: {
				name: "new-agent",
				description: "new",
				prompt: "hello",
			},
		},
	};
	await assert.rejects(
		store.save(request, () => {
			throw new Error("untrusted");
		}),
		/untrusted/,
	);
	await store.save(request);
	await assert.rejects(store.save(request));
	const updated = { ...request, generation: (await store.read()).generation };
	await assert.rejects(store.save(updated));
	await assert.rejects(
		store.save({
			...updated,
			edit: { definition: { ...request.edit.definition, name: "other" } },
		}),
	);
	await assert.rejects(store.save({ ...updated, filename: "../escape" }));
	assert.equal((await store.read()).agents[0]?.name, "new-agent");
	assert.equal(
		parse(
			await readFile(join(root, ".codex/agents/new-agent.toml"), "utf8"),
		).name,
		"new-agent",
	);
});

void test("Pi の名前と本文を編集し、YAML の未知の設定を保持して上書き設定も新しい名前へ移す", async () => {
	const { root, store } = await fixture();
	await mkdir(join(root, ".pi/agents"), { recursive: true });
	await writeFile(
		join(root, ".pi/agents/reviewer.md"),
		"---\n# keep\nname: reviewer\ndescription: |\n  old description\ntools: [read, ls]\nsystemPromptMode: append\ncustom: true\n---\nold prompt",
	);
	await writeFile(
		join(root, ".pi/settings.json"),
		JSON.stringify({
			unrelated: true,
			subagents: {
				agentOverrides: {
					reviewer: {
						model: "test-model",
						thinking: "low",
						disabled: false,
						custom: "keep",
					},
				},
			},
		}),
	);
	const state = await store.read();
	const agent = state.agents.find((item) => item.backend === "pi")!;
	assert.equal(agent.definitionPath, ".pi/agents/reviewer.md");
	await store.save({
		type: "agent",
		id: 1,
		workspace: "test",
		generation: state.generation,
		agentId: agent.id,
		edit: {
			...agent.edit,
			definition: {
				name: "renamed",
				description: "新しい説明\n次の行",
				prompt: "新しい本文\n---\n引用",
			},
			thinking: "high",
		},
	});
	const reloaded = await store.read();
	const result = reloaded.agents.find((item) => item.id === "pi:renamed")!;
	assert.equal(result.edit.thinking, "high");
	assert.equal(result.edit.definition!.prompt, "新しい本文\n---\n引用");
	assert.deepEqual(result.tools, ["read", "ls"]);
	assert.match(
		await readFile(join(root, ".pi/agents/reviewer.md"), "utf8"),
		/# keep/,
	);
	const settings = z
		.object({
			unrelated: z.boolean(),
			subagents: z.object({
				agentOverrides: z.record(z.string(), z.unknown()),
			}),
		})
		.parse(
			JSON.parse(await readFile(join(root, ".pi/settings.json"), "utf8")),
		);
	assert.equal(settings.unrelated, true);
	assert.equal(settings.subagents.agentOverrides.reviewer, undefined);
	assert.deepEqual(settings.subagents.agentOverrides.renamed, {
		custom: "keep",
		model: "test-model",
		thinking: "high",
		disabled: false,
	});
});

void test("ハンドオフは表示中のバックエンドだけを更新し、非表示側の設定とモデル指定を保持する", async () => {
	const { root, store } = await fixture();
	const config = defaultHandoff();
	config.backends.pi = {
		strategy: "fixed",
		model: "unavailable",
		thinking: "high",
	};
	await mkdir(join(root, ".nerita"));
	await writeFile(join(root, ".nerita/handoff.json"), JSON.stringify(config));
	const state = await store.read();
	const edited = defaultHandoff();
	edited.backends.codex = {
		strategy: "fixed",
		model: "test-model",
		reasoningEffort: "low",
	};
	await store.save({
		type: "handoff",
		backend: "codex",
		id: 1,
		workspace: "test",
		generation: state.generation,
		config: edited,
	});
	const result = (await store.read()).handoff;
	assert.deepEqual(result.backends.pi, {
		strategy: "fixed",
		model: "unavailable",
		thinking: "high",
	});
	assert.deepEqual(result.backends.codex, {
		strategy: "fixed",
		model: "test-model",
		reasoningEffort: "low",
	});
});

void test("ハンドオフの期限は1〜600秒の整数秒だけを保存・再読込みできる", async () => {
	const { store } = await fixture();
	for (const timeoutMs of [1000, 600000]) {
		const config = { ...defaultHandoff(), defaults: { timeoutMs } };
		await store.save({
			type: "handoff",
			backend: "pi",
			id: 1,
			workspace: "test",
			generation: (await store.read()).generation,
			config,
		});
		assert.equal(
			(await store.read()).handoff.defaults.timeoutMs,
			timeoutMs,
		);
	}
	for (const timeoutMs of [0, 999, 1500, 600001]) {
		assert.equal(
			handoffSchema.safeParse({
				...defaultHandoff(),
				defaults: { timeoutMs },
			}).success,
			false,
		);
	}
});

void test("Pi 新規定義を SDK が読み込め、リンク先の定義ディレクトリには書き込まない", async () => {
	const { root, store } = await fixture();
	await store.save({
		type: "createAgent",
		backend: "pi",
		id: 1,
		workspace: "test",
		generation: (await store.read()).generation,
		filename: "created",
		edit: {
			definition: {
				name: "created",
				description: "説明",
				prompt: "本文",
			},
			model: "test-model",
			thinking: "low",
		},
	});
	const created = (await store.read()).agents.find(
		(item) => item.backend === "pi",
	)!;
	assert.equal(created.name, "created");
	assert.equal(created.definitionModel, "test-model");
	assert.equal(created.definitionThinking, "low");
	const other = await fixture();
	await mkdir(join(other.root, ".codex"));
	await symlink(
		join(root, ".pi/agents"),
		join(other.root, ".codex/agents"),
		"junction",
	);
	await assert.rejects(
		other.store.save({
			type: "createAgent",
			backend: "codex",
			id: 1,
			workspace: "test",
			generation: (await other.store.read()).generation,
			filename: "outside",
			edit: {
				definition: { name: "outside", description: "", prompt: "" },
			},
		}),
	);
});

void test("Pi の上書き設定が保存できなければ先に書いた定義を元へ戻す", async () => {
	const { root, store } = await fixture();
	await mkdir(join(root, ".pi/agents"), { recursive: true });
	const original = "---\nname: reviewer\ndescription: old\n---\noriginal";
	await writeFile(join(root, ".pi/agents/reviewer.md"), original);
	const state = await store.read();
	let checks = 0;
	await assert.rejects(
		store.save(
			{
				type: "agent",
				id: 1,
				workspace: "test",
				generation: state.generation,
				agentId: "pi:reviewer",
				edit: {
					definition: {
						name: "changed",
						description: "new",
						prompt: "new",
					},
				},
			},
			() => {
				if (++checks === 2) {
					mkdirSync(join(root, ".pi/settings.json"));
				}
			},
		),
	);
	assert.equal(
		await readFile(join(root, ".pi/agents/reviewer.md"), "utf8"),
		original,
	);
});

void test("Codex の管理画面では Pi の設定読込みや不正な Pi 設定の報告を行わない", async () => {
	const { root } = await fixture();
	await mkdir(join(root, ".pi"));
	await writeFile(join(root, ".pi/settings.json"), "invalid json");
	let reads = 0;
	const store = new AgentManagerStore(
		root,
		() => {
			reads++;
			return Promise.reject(new Error("Pi reader called"));
		},
		() => [],
		() => "codex",
	);
	assert.deepEqual((await store.read()).errors, []);
	assert.equal(reads, 0);
});
