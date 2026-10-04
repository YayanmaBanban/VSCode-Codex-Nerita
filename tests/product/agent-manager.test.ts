// 実際の保存と再読込みを通し、定義・権限・競合時のデータ保持を検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { parse } from "smol-toml";
import { z } from "zod";
import { AgentManagerStore } from "../../apps/vscode-nerita/src/extension/agentManager/AgentManagerStore";
import { readPiAgents } from "../../apps/vscode-nerita/src/extension/agentManager/PiAgentSettings";
import { readWorkspaceFile } from "../../apps/vscode-nerita/src/extension/agentManager/WorkspaceFiles";
import { editCodexAgent } from "../../apps/vscode-nerita/src/extension/agentManager/CodexAgentEdit";
import {
	defaultHandoff,
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

const granular = {
	sandbox_approval: false,
	rules: true,
	skill_approval: false,
	request_permissions: true,
	mcp_elicitations: false,
};

void test("Codex の定義・権限を保存し、granular と文字列の切替でも未知の設定とコメントを保持する", async () => {
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
		sandboxMode: "workspace-write",
		approvalsReviewer: "auto_review",
		approvalPolicy: { granular },
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
		sandbox_mode: "workspace-write",
		approvals_reviewer: "auto_review",
		custom: { flag: true },
		approval_policy: { granular },
	});
	assert.deepEqual(
		(await store.read()).agents.find((agent) => agent.backend === "codex")!
			.edit,
		edit,
	);
	for (const approvalPolicy of ["never", "on-request", undefined] as const) {
		const next = editCodexAgent(saved, { ...edit, approvalPolicy });
		assert.equal(parse(next).approval_policy, approvalPolicy);
		assert.deepEqual(parse(next).custom, { flag: true });
	}
});

void test("TOML のインライン・ドット付き・引用テーブルの承認設定を重複なく置き換える", () => {
	const edits: AgentEdit = { approvalPolicy: "never" };
	for (const text of [
		"approval_policy = { granular = { rules = true } }\n",
		"approval_policy.granular.rules = true\napproval_policy.granular.sandbox_approval = false\n",
		'["approval_policy"."granular"]\nrules = true\n[unrelated]\nvalue = 1\n',
	]) {
		const parsed = parse(editCodexAgent(text, edits));
		assert.equal(parsed.approval_policy, "never");
	}
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
	await assert.rejects(store.save(request), /再読み込み/);
	const updated = { ...request, generation: (await store.read()).generation };
	await assert.rejects(store.save(updated), /同名/);
	await assert.rejects(
		store.save({
			...updated,
			edit: { definition: { ...request.edit.definition, name: "other" } },
		}),
		/別の編集/,
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
		/リンク先|保存先/,
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
		/サイズが不正/,
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
