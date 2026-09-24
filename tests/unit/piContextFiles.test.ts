// 実SDKを接続し、自動コンテキスト・reloadがbrokerと同じ読取り境界を守ることを検証する。
import * as sdk from "@earendil-works/pi-coding-agent";
import type * as FileSystem from "node:fs/promises";
import {
	mkdtemp,
	mkdir,
	realpath,
	rm,
	symlink,
	writeFile,
	link,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { loadPiResources } from "../../src/extension/backends/pi/PiResources";
import { createWorkspaceAccessPolicy } from "../../src/extension/security/WorkspacePathPolicy";

const resolvedLinks = vi.hoisted(() => new Map<string, string>());
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof FileSystem>();
	return {
		...actual,
		realpath: (path: string) =>
			resolvedLinks.has(path)
				? Promise.resolve(resolvedLinks.get(path)!)
				: actual.realpath(path),
	};
});

let base: string;
let root: string;
let outside: string;
beforeEach(async () => {
	base = await realpath(await mkdtemp(join(tmpdir(), "nerita-context-")));
	root = join(base, "workspace");
	outside = join(base, "private");
	await Promise.all([mkdir(root), mkdir(outside)]);
});
afterEach(async () => {
	resolvedLinks.clear();
	await rm(base, { recursive: true, force: true });
});

/** 設定はメモリだけに置き、実在するfixture以外の認証情報には触れない。 */
async function resources(protectedPath?: string) {
	const policy = await createWorkspaceAccessPolicy([root]);
	if (protectedPath) {
		policy.filesystem.protectedPaths = [
			...policy.filesystem.protectedPaths,
			protectedPath,
		];
	}
	return loadPiResources(
		sdk,
		root,
		outside,
		sdk.SettingsManager.inMemory({}, { projectTrusted: true }),
		vi.fn(),
		new AbortController().signal,
		policy,
		[],
	);
}

it("workspaceの本文を読み、祖先・global contextは読み込まない", async () => {
	await writeFile(join(base, "AGENTS.md"), "OUTSIDE_PARENT_SENTINEL");
	await writeFile(join(outside, "AGENTS.md"), "GLOBAL_SENTINEL");
	await writeFile(join(outside, "SYSTEM.md"), "GLOBAL_SYSTEM_SENTINEL");
	await writeFile(join(root, "AGENTS.md"), "workspace instructions");
	await mkdir(join(root, ".pi"));
	await writeFile(join(root, ".pi/SYSTEM.md"), "workspace system");
	await writeFile(join(root, ".pi/APPEND_SYSTEM.md"), "workspace appendix");
	const loader = await resources();
	expect(loader.getAgentsFiles().agentsFiles).toEqual([
		{ path: join(root, "AGENTS.md"), content: "workspace instructions" },
	]);
	expect(loader.getSystemPrompt()).toBe("workspace system");
	expect(loader.getAppendSystemPrompt()).toEqual(["workspace appendix"]);
}, 15000);

it.each(["AGENTS.md", "CLAUDE.md"])(
	"%sのworkspace外symlink実体解決を模擬して拒否する",
	async (name) => {
		const secret = join(outside, "synthetic-secret");
		await writeFile(secret, "SYNTHETIC_SECRET");
		await writeFile(join(root, name), "link placeholder");
		resolvedLinks.set(join(root, name), secret);
		await expect(resources()).rejects.toThrow("境界");
	},
);
it.each(["SYSTEM.md", "APPEND_SYSTEM.md"])(
	".pi/%sのjunction経由の読取りを拒否する",
	async (name) => {
		await writeFile(join(outside, name), "SYNTHETIC_SECRET");
		await symlink(outside, join(root, ".pi"), "junction");
		await expect(resources()).rejects.toThrow("境界");
	},
);
it("workspace内でも保護対象へリンクしたAGENTS.mdを拒否する", async () => {
	const protectedPath = join(root, "protected");
	await mkdir(protectedPath);
	const secret = join(protectedPath, "synthetic");
	await writeFile(secret, "SYNTHETIC_SECRET");
	await writeFile(join(root, "AGENTS.md"), "link placeholder");
	resolvedLinks.set(join(root, "AGENTS.md"), secret);
	await expect(resources(protectedPath)).rejects.toThrow("保護");
});
it("reloadでリンクへ差し替わったcontextを拒否し古いsnapshotも公開しない", async () => {
	const agent = join(root, "AGENTS.md");
	await writeFile(agent, "original");
	const loader = await resources();
	await rm(agent);
	const secret = join(outside, "synthetic");
	await writeFile(secret, "SYNTHETIC_SECRET");
	await link(secret, agent);
	await expect(loader.reload()).rejects.toThrow("hard link");
	expect(loader.getAgentsFiles().agentsFiles).toEqual([]);
});
it("SYSTEM.mdの本文が実在パスでも再度ファイルとして読まない", async () => {
	await mkdir(join(root, ".pi"));
	const secret = join(outside, "synthetic");
	await writeFile(secret, "SYNTHETIC_SECRET");
	await writeFile(join(root, ".pi/SYSTEM.md"), secret);
	expect((await resources()).getSystemPrompt()).toBe(secret);
});
it("skills/promptsの直接読込みによる同種の迂回も無効にする", async () => {
	await mkdir(join(root, ".pi"));
	await mkdir(join(outside, "skills"));
	await writeFile(
		join(outside, "skills/SKILL.md"),
		"---\nname: unsafe\ndescription: SYNTHETIC_SECRET\n---\nbody",
	);
	await mkdir(join(outside, "prompts"));
	await writeFile(join(outside, "prompts/unsafe.md"), "SYNTHETIC_SECRET");
	await symlink(
		join(outside, "skills"),
		join(root, ".pi/skills"),
		"junction",
	);
	await symlink(
		join(outside, "prompts"),
		join(root, ".pi/prompts"),
		"junction",
	);
	const loader = await resources();
	expect(loader.getSkills().skills).toEqual([]);
	expect(loader.getPrompts().prompts).toEqual([]);
});
