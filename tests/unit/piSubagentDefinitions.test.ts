// エージェント定義の出所とサイズ・リンク境界を実 SDK のパーサーで確認する。
import { afterEach, expect, it } from "vitest";
import * as sdk from "@earendil-works/pi-coding-agent";
import { mkdir, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { loadSubagentDefinitions } from "../../src/extension/backends/pi/PiSubagentDefinitions";
import { sandboxFixture } from "./sandboxFixtures";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/** ユーザーとプロジェクトを隔離した定義ディレクトリに置く。 */
async function fixture() {
	const h = await sandboxFixture();
	cleanups.push(() => h.cleanup());
	const user = join(h.outside, "agents");
	const project = join(h.cwd, ".pi/agents");
	await mkdir(user);
	await mkdir(project, { recursive: true });
	const settings = sdk.SettingsManager.create(h.cwd, h.outside);
	settings.setProjectTrusted(true);
	return {
		...h,
		user,
		project,
		settings,
		load: () =>
			loadSubagentDefinitions(sdk, h.cwd, h.outside, settings, []),
	};
}
it("本文を実行せず固定データにし、ユーザーとプロジェクトを区別する", async () => {
	const h = await fixture();
	await writeFile(
		join(h.user, "reviewer.md"),
		"---\nname: reviewer\ndescription: user\ntools: [read, ls]\nmodel: local/guard\nthinking: low\n---\nUSER_PROMPT",
	);
	await writeFile(
		join(h.project, "reviewer.md"),
		"---\nname: reviewer\ndescription: project\n---\nPROJECT_PROMPT",
	);
	const result = await h.load();
	expect(result.definitions.map((agent) => agent.source)).toEqual([
		"user",
		"project",
	]);
	expect(result.definitions[0]).toMatchObject({
		tools: ["read", "ls"],
		model: "local/guard",
		thinking: "low",
		prompt: "USER_PROMPT",
	});
	h.settings.setProjectTrusted(false);
	expect((await h.load()).definitions.map((agent) => agent.source)).toEqual([
		"user",
	]);
});
it("過大な定義は起動時に拒否する", async () => {
	const h = await fixture();
	await writeFile(join(h.user, "large.md"), "x".repeat(65537));
	await expect(h.load()).rejects.toThrow("サイズ");
});

it("pi-subagents の直下の定義を読み、ルート entry を Host 実行へ置き換える", async () => {
	const h = await fixture();
	const root = join(h.outside, "package");
	await mkdir(join(root, "agents"), { recursive: true });
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({
			name: "pi-subagents",
			pi: { extensions: ["index.js"] },
		}),
	);
	await writeFile(
		join(root, "index.js"),
		"throw new Error('must not load');",
	);
	await writeFile(
		join(root, "agents/worker.md"),
		"---\nname: worker\ndescription: fixture\naliases: developer, coder\nsystemPromptMode: replace\n---\nWORKER",
	);
	await writeFile(
		join(root, "agents/external.md"),
		"---\nname: external\ndescription: fixture\nrunner:\n  type: external-cli\n  command: ignored\n---\nEXTERNAL",
	);
	const result = await loadSubagentDefinitions(
		sdk,
		h.cwd,
		h.outside,
		h.settings,
		[join(root, "index.js")],
	);
	expect(result.trusted).toEqual([]);
	expect(result.workflowPackage).toBeUndefined();
	h.settings.setPackages([root]);
	expect((await h.load()).workflowPackage).toBe(root);
	expect(
		result.definitions.find((agent) => agent.name === "worker"),
	).toMatchObject({
		aliases: ["developer", "coder"],
		systemPromptMode: "replace",
	});
	expect(
		result.definitions.find((agent) => agent.name === "external")
			?.unavailableReason,
	).toContain("非対応");
});

it("定義を再帰探索し、chainファイルと循環リンクを除外する", async () => {
	const h = await fixture();
	await mkdir(join(h.user, "nested"));
	await writeFile(
		join(h.user, "nested/reviewer.md"),
		"---\nname: reviewer\ndescription: nested\n---\nNESTED",
	);
	await writeFile(join(h.user, "workflow.chain.md"), "not an agent");
	await symlink(h.user, join(h.user, "nested/loop"), "junction");
	expect((await h.load()).definitions.map((agent) => agent.name)).toEqual([
		"reviewer",
	]);
});

it("未導入の pi-subagents と空の定義ではエラーにならない", async () => {
	const h = await fixture();
	h.settings.setPackages([join(h.outside, "missing-pi-subagents")]);
	expect((await h.load()).definitions).toEqual([]);
});
it("プロジェクトの定義ディレクトリから外部へ抜けるリンクを拒否する", async () => {
	const h = await sandboxFixture();
	cleanups.push(() => h.cleanup());
	await mkdir(join(h.cwd, ".pi"));
	await symlink(h.outside, join(h.cwd, ".pi/agents"), "junction");
	const settings = sdk.SettingsManager.create(h.cwd, h.outside);
	settings.setProjectTrusted(true);
	await expect(
		loadSubagentDefinitions(sdk, h.cwd, h.outside, settings, []),
	).rejects.toThrow("範囲外");
});
