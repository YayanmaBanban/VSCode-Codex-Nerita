// 実ファイルで設定の保存先・世代競合・既存定義の保持を検証する。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	mkdtemp,
	mkdir,
	readFile,
	writeFile,
	rm,
	symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "smol-toml";
import { z } from "zod";
import { AgentManagerStore } from "../../src/extension/agentManager/AgentManagerStore";
import { editCodexAgent } from "../../src/extension/agentManager/CodexAgentEdit";
import { codexAgentFiles } from "../../src/extension/agentManager/CodexAgentFiles";
import { piSettings } from "../../src/extension/agentManager/PiAgentSettings";
import { readWorkspaceFile } from "../../src/extension/agentManager/WorkspaceFiles";
import {
	defaultHandoff,
	handoffSchema,
} from "../../src/shared/agentManager/config";
import { managerRequestSchema } from "../../src/shared/agentManager/messages";

let root: string;
const definition =
	'# Keep this comment\r\nname = "reviewer"\r\ndescription = "Review"\r\nmodel = "old" # selected model\r\nmodel_reasoning_effort = "high"\r\ndeveloper_instructions = """\r\nmodel = "leave prompt alone"\r\n[not_a_table]\r\n"""\r\n[mcp_servers.local]\r\nmodel = "leave nested model alone"\r\n';

/** 実 SDK の代わりに既存ローダーの表示結果だけを差し替える。 */
function store(efforts = ["low", "medium", "high"]) {
	return new AgentManagerStore(
		root,
		async () => {
			const settings = piSettings(
				await readWorkspaceFile(root, ".pi/settings.json"),
			);
			return {
				agents: [
					{
						id: "pi:reviewer",
						backend: "pi" as const,
						name: "reviewer",
						description: "Review",
						source: "extension" as const,
						aliases: [],
						tools: ["read"],
						edit: settings.agentOverrides?.reviewer ?? {},
						editable: true,
					},
				],
				defaults: {},
				userSettings: "{}",
				modelScope: "{}",
				fingerprint: "definition",
			};
		},
		() =>
			["new", "gpt-6-sol", "openai-codex/gpt-6-sol"].map((value) => ({
				name: value,
				value,
				efforts,
			})),
	);
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "nerita-agent-manager-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("Agent Manager persistence", () => {
	it("saves and reloads provider-supported Ultra in Pi agent, defaults and handoff settings", async () => {
		const manager = store(["low", "high", "ultra"]);
		const base = { id: 1, workspace: "test" };
		await manager.save({
			...base,
			type: "agent",
			generation: (await manager.read()).generation,
			agentId: "pi:reviewer",
			edit: { model: "new", thinking: "ultra" },
		});
		expect((await manager.read()).agents[0]?.edit.thinking).toBe("ultra");
		await manager.save({
			...base,
			type: "defaults",
			generation: (await manager.read()).generation,
			defaults: { defaultModel: "new", defaultThinking: "ultra" },
		});
		const config = defaultHandoff();
		config.backends.pi = {
			strategy: "fixed",
			model: "openai-codex/gpt-6-sol",
			thinking: "ultra",
		};
		await manager.save({
			...base,
			type: "handoff",
			generation: (await manager.read()).generation,
			config,
		});
		expect((await manager.read()).handoff).toEqual(config);
	});
	it("rejects unsupported efforts in agent, defaults and fixed handoff saves", async () => {
		const manager = store();
		const base = {
			id: 1,
			workspace: "test",
			generation: (await manager.read()).generation,
		};
		await expect(
			manager.save({
				...base,
				type: "agent",
				agentId: "pi:reviewer",
				edit: { model: "new", thinking: "max" },
			}),
		).rejects.toThrow("非対応");
		await expect(
			manager.save({
				...base,
				type: "defaults",
				defaults: { defaultModel: "new", defaultThinking: "max" },
			}),
		).rejects.toThrow("非対応");
		const config = defaultHandoff();
		config.backends.codex = {
			strategy: "fixed",
			model: "gpt-6-sol",
			reasoningEffort: "ultra",
		};
		await expect(
			manager.save({ ...base, type: "handoff", config }),
		).rejects.toThrow("非対応");
		await expect(
			readFile(join(root, ".nerita/handoff.json")),
		).rejects.toMatchObject({ code: "ENOENT" });
	});
	it("creates a Pi override even when optional fields and their parents are absent", async () => {
		const manager = store();
		await manager.save({
			type: "agent",
			id: 1,
			workspace: "test",
			generation: (await manager.read()).generation,
			agentId: "pi:reviewer",
			edit: { disabled: true },
		});
		expect(
			JSON.parse(await readFile(join(root, ".pi/settings.json"), "utf8")),
		).toEqual({
			subagents: { agentOverrides: { reviewer: { disabled: true } } },
		});
		await manager.save({
			type: "defaults",
			id: 2,
			workspace: "test",
			generation: (await manager.read()).generation,
			defaults: { maxSubagentSpawnsPerSession: 0 },
		});
		expect(
			piSettings(await readFile(join(root, ".pi/settings.json"), "utf8"))
				.maxSubagentSpawnsPerSession,
		).toBe(0);
	});
	it("changes only Codex model fields and keeps instructions, nested tables, CRLF and comments", async () => {
		await mkdir(join(root, ".codex/agents"), { recursive: true });
		await writeFile(join(root, ".codex/agents/reviewer.toml"), definition);
		const manager = store();
		const state = await manager.read();
		await manager.save({
			type: "agent",
			id: 1,
			workspace: "test",
			generation: state.generation,
			agentId: ".codex/agents/reviewer.toml",
			edit: { model: "new", reasoningEffort: "medium" },
		});
		const actual = await readFile(
			join(root, ".codex/agents/reviewer.toml"),
			"utf8",
		);
		expect(parse(actual)).toEqual({
			...parse(definition),
			model: "new",
			model_reasoning_effort: "medium",
		});
		expect(actual).toContain("# Keep this comment\r\n");
		expect(actual).toContain('model = "new" # selected model\r\n');
		expect(actual).toContain('model = "leave prompt alone"');
	});
	it("preserves unrelated Pi settings and clears only owned override fields", async () => {
		await mkdir(join(root, ".pi"));
		const original = {
			theme: "dark",
			subagents: {
				modelScope: ["openai/*"],
				agentOverrides: {
					reviewer: {
						model: "old",
						thinking: "high",
						tools: ["read"],
					},
					other: { disabled: true },
				},
			},
		};
		await writeFile(
			join(root, ".pi/settings.json"),
			JSON.stringify(original, null, 2),
		);
		const manager = store();
		await manager.save({
			type: "agent",
			id: 1,
			workspace: "test",
			generation: (await manager.read()).generation,
			agentId: "pi:reviewer",
			edit: { disabled: true },
		});
		const actual: unknown = JSON.parse(
			await readFile(join(root, ".pi/settings.json"), "utf8"),
		);
		expect(actual).toEqual({
			theme: "dark",
			subagents: {
				modelScope: ["openai/*"],
				agentOverrides: {
					reviewer: { tools: ["read"], disabled: true },
					other: { disabled: true },
				},
			},
		});
	});
	it("rejects external edits and concurrent saves from the same generation", async () => {
		const manager = store();
		const state = await manager.read();
		const request = {
			type: "handoff" as const,
			id: 1,
			workspace: "test",
			generation: state.generation,
			config: defaultHandoff(),
		};
		const results = await Promise.allSettled([
			manager.save(request),
			manager.save(request),
		]);
		expect(results.map((result) => result.status)).toEqual([
			"fulfilled",
			"rejected",
		]);
		const current = await manager.read();
		await writeFile(
			join(root, ".nerita/handoff.json"),
			JSON.stringify({
				...defaultHandoff(),
				defaults: { timeoutMs: 42 },
			}),
		);
		await expect(
			manager.save({ ...request, generation: current.generation }),
		).rejects.toThrow("再読み込み");
	});
	it("writes only handoff configuration and uses the bundled schema", async () => {
		const manager = store();
		const config = handoffSchema.parse({
			...defaultHandoff(),
			backends: {
				pi: {
					strategy: "fixed",
					model: "openai-codex/gpt-6-sol",
					thinking: "high",
				},
				codex: {
					strategy: "fixed",
					model: "gpt-6-sol",
					reasoningEffort: "high",
				},
			},
		});
		await manager.save({
			type: "handoff",
			id: 1,
			workspace: "test",
			generation: (await manager.read()).generation,
			config,
		});
		expect(
			JSON.parse(
				await readFile(join(root, ".nerita/handoff.json"), "utf8"),
			),
		).toEqual(config);
		await expect(
			readFile(join(root, ".nerita/handoff.schema.json")),
		).rejects.toMatchObject({ code: "ENOENT" });
		expect(config).not.toHaveProperty("$schema");
		const schema: unknown = JSON.parse(
			await readFile(
				"src/shared/agentManager/handoff.schema.json",
				"utf8",
			),
		);
		expect(schema).toEqual(z.toJSONSchema(handoffSchema));
	});
	it("removes the legacy schema reference on save while retaining the old schema file", async () => {
		await mkdir(join(root, ".nerita"));
		await writeFile(
			join(root, ".nerita/handoff.json"),
			JSON.stringify({
				...defaultHandoff(),
				$schema: "./handoff.schema.json",
			}),
		);
		await writeFile(
			join(root, ".nerita/handoff.schema.json"),
			"legacy schema",
		);
		const manager = store();
		const state = await manager.read();
		expect(state.handoffError).toBeNull();
		await manager.save({
			type: "handoff",
			id: 1,
			workspace: "test",
			generation: state.generation,
			config: state.handoff,
		});
		expect(
			JSON.parse(
				await readFile(join(root, ".nerita/handoff.json"), "utf8"),
			),
		).not.toHaveProperty("$schema");
		expect(
			await readFile(join(root, ".nerita/handoff.schema.json"), "utf8"),
		).toBe("legacy schema");
	});
	it("never silently replaces broken settings when only reading", async () => {
		await mkdir(join(root, ".nerita"));
		await writeFile(join(root, ".nerita/handoff.json"), "{");
		const result = await store().read();
		expect(result.handoffError).toContain("形式が不正");
		expect(await readFile(join(root, ".nerita/handoff.json"), "utf8")).toBe(
			"{",
		);
	});
	it("rejects unavailable models and cross-backend fields", async () => {
		const manager = store();
		const base = {
			type: "agent" as const,
			id: 1,
			workspace: "test",
			generation: (await manager.read()).generation,
			agentId: "pi:reviewer",
		};
		await expect(
			manager.save({ ...base, edit: { model: "missing" } }),
		).rejects.toThrow("利用可能");
		await expect(
			manager.save({ ...base, edit: { reasoningEffort: "high" } }),
		).rejects.toThrow("Codex");
	});
	it("does not follow a settings directory junction outside the workspace", async () => {
		const outside = await mkdtemp(
			join(tmpdir(), "nerita-manager-outside-"),
		);
		try {
			await symlink(outside, join(root, ".nerita"), "junction");
			await expect(
				readWorkspaceFile(root, ".nerita/handoff.json"),
			).rejects.toThrow("リンク");
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});
	it("ignores nested Codex files and marks duplicate canonical names", async () => {
		await mkdir(join(root, ".codex/agents/nested"), { recursive: true });
		await writeFile(join(root, ".codex/agents/a.toml"), definition);
		await writeFile(join(root, ".codex/agents/b.toml"), definition);
		await writeFile(
			join(root, ".codex/agents/nested/hidden.toml"),
			definition,
		);
		const result = await codexAgentFiles(root);
		expect(result.agents).toHaveLength(2);
		expect(result.agents.every((agent) => !agent.editable)).toBe(true);
	});
});

describe("configuration validation", () => {
	it("requires fixed model, disallows current model, and checks timeout and backend effort", () => {
		const config = defaultHandoff();
		expect(handoffSchema.safeParse(config).success).toBe(true);
		for (const pi of [
			{ strategy: "fixed" },
			{ strategy: "current", model: "stale" },
			{ strategy: "current", reasoningEffort: "high" },
		]) {
			expect(
				handoffSchema.safeParse({
					...config,
					backends: { ...config.backends, pi },
				}).success,
			).toBe(false);
		}
		for (const timeoutMs of [0, -1, 1.5, 2147483648]) {
			expect(
				handoffSchema.safeParse({ ...config, defaults: { timeoutMs } })
					.success,
			).toBe(false);
		}
	});
	it("requires workspace and generation and rejects arbitrary file paths in payloads", () => {
		expect(
			managerRequestSchema.safeParse({
				type: "agent",
				id: 1,
				agentId: "x",
				edit: {},
			}).success,
		).toBe(false);
		expect(
			managerRequestSchema.safeParse({
				type: "handoff",
				id: 1,
				workspace: "x",
				generation: "y",
				path: "../other",
				config: defaultHandoff(),
			}).success,
		).toBe(false);
	});
	it("handles quoted keys and hashes inside strings without corrupting comments", () => {
		const text =
			'name = "a"\ndescription = "b"\ndeveloper_instructions = "c"\n"model" = "old # value" # retained\n';
		const actual = editCodexAgent(text, {
			model: "new",
			reasoningEffort: "high",
		});
		expect(actual).toContain('model = "new" # retained');
		expect(parse(actual).model_reasoning_effort).toBe("high");
		expect(parse(editCodexAgent(actual, {})).model).toBeUndefined();
	});
});
