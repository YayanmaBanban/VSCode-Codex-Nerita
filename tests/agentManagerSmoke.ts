// 同梱 SDK の定義読込みと設定保存を、ユーザー環境から隔離して確認する。
import * as assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { readPiAgents } from "../src/extension/agentManager/PiAgentSettings";
import { AgentManagerStore } from "../src/extension/agentManager/AgentManagerStore";
import { readWorkspaceFile } from "../src/extension/agentManager/WorkspaceFiles";
import { defaultHandoff } from "../src/shared/agentManager/config";
import { agentModelReader } from "../src/extension/agentManager/AgentModelCatalog";

/** Pi の設定保存は、実効モデルを再計算せず定義本文を保持する。 */
export async function agentManagerSmoke(extensionPath: string) {
	const root = await mkdtemp(join(tmpdir(), "nerita-manager-host-"));
	const agentDir = join(root, "user");
	const previous = process.env.PI_CODING_AGENT_DIR;
	try {
		const sdk = (await import(
			pathToFileURL(join(extensionPath, "dist/runtime/pi.mjs")).href
		)) as {
			getSupportedThinkingLevels(model: {
				reasoning: boolean;
				thinkingLevelMap?: Record<string, string | null>;
			}): string[];
		};
		assert.deepEqual(sdk.getSupportedThinkingLevels({ reasoning: false }), [
			"off",
		]);
		const efforts = sdk.getSupportedThinkingLevels({
			reasoning: true,
			thinkingLevelMap: { high: null, max: "max" },
		});
		assert.equal(efforts.includes("high"), false);
		assert.equal(efforts.includes("max"), true);
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const codexModels = await agentModelReader(extensionPath, root)(
			"codex",
			new AbortController().signal,
		);
		assert.ok(codexModels.length > 0);
		assert.ok(codexModels.every((model) => Array.isArray(model.efforts)));
		await mkdir(join(agentDir, "agents"), { recursive: true });
		await mkdir(join(root, ".pi/agents"), { recursive: true });
		const prompt =
			"---\nname: reviewer\ndescription: Review changes\nmodel: openai-codex/gpt-6-sol\nthinking: high\n---\nReview the source.\n";
		await writeFile(join(root, ".pi/agents/reviewer.md"), prompt);
		await writeFile(
			join(agentDir, "settings.json"),
			'{"subagents":{"defaultThinking":"low"}}',
		);
		const manager = new AgentManagerStore(
			root,
			async () =>
				readPiAgents(
					extensionPath,
					root,
					true,
					await readWorkspaceFile(root, ".pi/settings.json"),
				),
			() => [
				{
					value: "openai-codex/gpt-6-sol",
					name: "Model",
					efforts: sdk.getSupportedThinkingLevels({
						reasoning: true,
					}),
				},
			],
		);
		const before = await manager.read();
		assert.deepEqual(before.errors, []);
		assert.equal(before.agents[0]?.name, "reviewer");
		assert.match(before.piUserSettings, /low/);
		await manager.save({
			type: "agent",
			id: 1,
			workspace: "test",
			generation: before.generation,
			agentId: "pi:reviewer",
			edit: {
				disabled: true,
				model: "openai-codex/gpt-6-sol",
				thinking: "medium",
			},
		});
		const after = await manager.read();
		assert.equal(after.agents[0]?.edit.disabled, true);
		assert.equal(after.agents[0]?.definitionThinking, "high");
		assert.equal(
			await readFile(join(root, ".pi/agents/reviewer.md"), "utf8"),
			prompt,
		);
		assert.equal(
			await readFile(join(agentDir, "settings.json"), "utf8"),
			'{"subagents":{"defaultThinking":"low"}}',
		);
		await manager.save({
			type: "handoff",
			id: 2,
			workspace: "test",
			generation: after.generation,
			config: defaultHandoff(),
		});
		assert.deepEqual(
			JSON.parse(
				await readFile(join(root, ".nerita/handoff.json"), "utf8"),
			),
			defaultHandoff(),
		);
	} finally {
		if (previous === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = previous;
		}
		await rm(root, { recursive: true, force: true });
	}
}
