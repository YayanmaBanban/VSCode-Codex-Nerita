// MCP の優先順位・無効化・不正な上位設定・改訂番号と読込み上限を検証する。
import { afterEach, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServerConfig } from "@earendil-works/pi-coding-agent";
import {
	loadPiMcpConfig,
	type PiMcpValidator,
} from "../../apps/vscode-nerita/src/extension/backends/pi/mcp/PiMcpConfig";
import { sandboxFixture } from "./sandboxFixtures";

const fixtures: Awaited<ReturnType<typeof sandboxFixture>>[] = [];
afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((item) => item.cleanup()));
});

// SDK の設定検証は実配布テストに任せ、ここでは成功・失敗の境界だけを差し替える。
const validate: PiMcpValidator = (_name, value) =>
	value === null ? "invalid" : (value as McpServerConfig);

/** 一時的な設定ファイルを使い、ワークスペースとグローバルの層を分ける。 */
async function fixture() {
	const files = await sandboxFixture();
	fixtures.push(files);
	const agentDir = join(files.root, "agent");
	await Promise.all([mkdir(agentDir), mkdir(join(files.cwd, ".pi"))]);
	const options = { cwd: files.cwd, agentDir, projectTrusted: true };
	const write = (project: boolean, servers: unknown) =>
		writeFile(
			join(project ? join(files.cwd, ".pi") : agentDir, "mcp.json"),
			JSON.stringify({ mcpServers: servers }),
		);
	return {
		...files,
		options,
		write,
		load: () => loadPiMcpConfig(options, validate),
	};
}

it("workspace > global > trusted extensionで同名を置換し、明示有効化とdeferredを既定にする", async () => {
	const h = await fixture();
	await h.write(false, {
		server: { command: "global", enabled: true },
		global: { command: "global-only" },
	});
	await h.write(true, { server: { command: "project", enabled: false } });
	const result = await loadPiMcpConfig(
		{
			...h.options,
			extensions: [
				{
					name: "server",
					extensionPath: "fixture",
					config: { command: "extension" },
				},
			],
		},
		validate,
	);
	expect(result.errors).toEqual([]);
	expect(result.entries).toMatchObject([
		{
			name: "server",
			scope: "project",
			config: {
				command: "project",
				enabled: false,
				exposure: "deferred",
			},
		},
		{ name: "global", config: { enabled: false, exposure: "deferred" } },
	]);
});

it("不正なworkspaceの同名定義をglobalへ戻さず、設定修正で改訂番号を変える", async () => {
	const h = await fixture();
	await h.write(false, { server: { command: "global", enabled: true } });
	await h.write(true, { server: null });
	const first = await h.load();
	expect(first.entries[0]?.scope).toBe("project");
	expect(first.entries[0]?.config).toBeUndefined();
	expect(first.entries[0]?.error).toBeDefined();
	await h.write(true, { server: { command: "fixed", enabled: true } });
	const second = await h.load();
	expect(second.entries[0]?.config?.enabled).toBe(true);
	expect(second.entries[0]?.revision).not.toBe(first.entries[0]?.revision);
});

it("未信頼workspaceを読まず、信頼後に壊れた上位設定があれば下位の起動を止める", async () => {
	const h = await fixture();
	await h.write(false, { server: { command: "global", enabled: true } });
	await writeFile(join(h.cwd, ".pi/mcp.json"), "malformed-private-text");
	const untrusted = await loadPiMcpConfig(
		{ ...h.options, projectTrusted: false },
		validate,
	);
	expect(untrusted.entries[0]?.scope).toBe("global");
	const trusted = await h.load();
	expect(trusted.entries).toEqual([]);
	expect(trusted.errors).toHaveLength(1);
	expect(JSON.stringify(trusted)).not.toContain("malformed-private-text");
});

it("承認外のコマンド補間と巨大なファイルを拒否し、秘密値をエラーへ複製しない", async () => {
	const h = await fixture();
	await h.write(false, {
		server: {
			url: "https://fixture.invalid/mcp",
			headers: { Authorization: "!echo private-token" },
			enabled: true,
		},
	});
	const result = await h.load();
	expect(result.entries[0]?.config).toBeUndefined();
	expect(JSON.stringify(result)).not.toContain("private-token");
	await writeFile(join(h.cwd, ".pi/mcp.json"), "private-data".repeat(30000));
	const large = await h.load();
	expect(large.entries).toEqual([]);
	expect(large.errors).toHaveLength(1);
	expect(JSON.stringify(large)).not.toContain("private-data");
});
