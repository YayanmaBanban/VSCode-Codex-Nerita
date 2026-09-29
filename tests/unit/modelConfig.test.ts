// 一時フォルダーだけで、設定の優先順位と保存先・既存本文の保持を検証する。
import { afterEach, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ModelConfig } from "../../apps/vscode-nerita/src/extension/settings/ModelConfig";
import { sandboxFixture } from "./sandboxFixtures";

const fixtures: Awaited<ReturnType<typeof sandboxFixture>>[] = [];
afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

/** ホームとワークスペースに相当する独立した保存先を用意する。 */
async function fixture(globalText = "", workspaceText = "") {
	const h = await sandboxFixture();
	fixtures.push(h);
	const globalFile = join(h.outside, ".nerita/config.toml");
	const workspaceFile = join(h.cwd, ".nerita/config.toml");
	await mkdir(join(h.outside, ".nerita"));
	await mkdir(join(h.cwd, ".nerita"));
	await writeFile(globalFile, globalText);
	await writeFile(workspaceFile, workspaceText);
	return {
		config: new ModelConfig(h.cwd, h.outside),
		globalFile,
		workspaceFile,
	};
}

it("Workspace の指定項目だけを優先し、UI 変更を各保存先に反映する", async () => {
	const h = await fixture(
		'[pi]\nprovider = "example"\nmodel = "global"\nreasoning = "low"\n',
		'# workspace\n[pi]\nmodel = "local" # keep\n[other]\nvalue = 3\n',
	);
	expect(await h.config.read("pi")).toMatchObject({
		provider: "example",
		model: "local",
		reasoning: "low",
	});
	await h.config.write("pi", {
		provider: "example",
		model: "changed",
		reasoning: "high",
	});
	expect(await readFile(h.workspaceFile, "utf8")).toBe(
		'# workspace\n[pi]\nmodel = "changed" # keep\n[other]\nvalue = 3\n',
	);
	expect(await readFile(h.globalFile, "utf8")).toContain('model = "global"');
	expect(await h.config.read("pi")).toMatchObject({
		model: "changed",
		reasoning: "high",
	});
});

it("未指定なら Global へ保存し、複数の変更でも Pi と Codex を保持する", async () => {
	const h = await fixture();
	await Promise.all([
		h.config.write("pi", { provider: "example", model: "pi-model" }),
		h.config.write("codex", { model: "codex-model", reasoning: "high" }),
	]);
	expect(await h.config.read("pi")).toMatchObject({
		provider: "example",
		model: "pi-model",
	});
	expect(await h.config.read("codex")).toMatchObject({
		model: "codex-model",
		reasoning: "high",
	});
	expect(await readFile(h.workspaceFile, "utf8")).toBe("");
});

it("壊れた設定は保存で破壊せず、読込みエラーとして返す", async () => {
	const h = await fixture("[broken");
	await expect(h.config.read("codex")).rejects.toThrow();
	await expect(h.config.write("codex", { model: "new" })).rejects.toThrow();
	expect(await readFile(h.globalFile, "utf8")).toBe("[broken");
});

it("複数行の値に含まれる設定風の本文を変更しない", async () => {
	const h = await fixture(
		'[other]\ntext = """\n[pi]\nmodel = fake\n"""\n[pi]\nmodel = "old"\n',
	);
	await h.config.write("pi", { model: "new" });
	expect(await readFile(h.globalFile, "utf8")).toContain(
		'[other]\ntext = """\n[pi]\nmodel = fake\n"""',
	);
	expect(await h.config.read("pi")).toMatchObject({ model: "new" });
});
