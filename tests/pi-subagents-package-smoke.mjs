// 導入済み pi-subagents の定義と承認境界を検証し、外部コードの起動を防ぐ。
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const extensionPath = process.cwd();
const packageDir =
	process.env.NERITA_SUBAGENTS_PACKAGE ??
	join(homedir(), ".pi/agent/npm/node_modules/pi-subagents");
const metadata = JSON.parse(
	await readFile(join(packageDir, "package.json"), "utf8"),
);
assert.equal(metadata.name, "pi-subagents");
const entry = resolve(packageDir, metadata.pi.extensions[0]);
const out = join(extensionPath, "dist/subagents-package-smoke");
await mkdir(out, { recursive: true });
const fixture = await mkdtemp(join(out, "run-"));
const cwd = join(fixture, "workspace");
const agentDir = join(fixture, "agent");
await Promise.all([mkdir(cwd), mkdir(agentDir)]);
await build({
	stdin: {
		contents: [
			'export { loadPiResources } from "./src/extension/backends/pi/PiResources";',
			'export { loadSubagentDefinitions } from "./src/extension/backends/pi/PiSubagentDefinitions";',
			'export { createPiSubagentTool } from "./src/extension/backends/pi/PiSubagentTool";',
		].join("\n"),
		resolveDir: extensionPath,
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node22",
	outfile: join(fixture, "host.cjs"),
});
const { loadPiResources, loadSubagentDefinitions, createPiSubagentTool } =
	createRequire(import.meta.url)(join(fixture, "host.cjs"));
const sdk = await import(
	pathToFileURL(join(extensionPath, "dist/runtime/pi.mjs")).href
);
await writeFile(
	join(agentDir, "settings.json"),
	JSON.stringify({ packages: [packageDir] }),
);
const settings = sdk.SettingsManager.create(cwd, agentDir);
const lifetime = new AbortController();
let requests = 0;
const authorize = () => {
	requests++;
	return Promise.reject(new Error("fixture: declined"));
};
const load = (paths) =>
	loadPiResources(
		sdk,
		cwd,
		agentDir,
		settings,
		authorize,
		lifetime.signal,
		undefined,
		paths,
	);
const untrusted = await load([]);
assert.equal(
	untrusted
		.getExtensions()
		.extensions.some((extension) => extension.tools.has("subagent")),
	false,
);
const adapted = await loadSubagentDefinitions(sdk, cwd, agentDir, settings, [
	entry,
]);
assert.deepEqual(adapted.trusted, []);
assert.ok(adapted.definitions.some((agent) => agent.name === "scout"));
assert.ok(adapted.definitions.some((agent) => agent.name === "reviewer"));
assert.ok(
	adapted.definitions.some(
		(agent) =>
			agent.name === "worker" && agent.aliases.includes("developer"),
	),
);
assert.ok(
	adapted.definitions.some(
		(agent) => agent.name === "codex-exec" && agent.unavailableReason,
	),
);
let opened = 0;
const tool = createPiSubagentTool(
	adapted.definitions,
	{
		open() {
			opened++;
			throw new Error("unexpected child");
		},
	},
	{
		workspaceRoots: [cwd],
		writableRoots: [cwd],
		shell: true,
		networkAccess: false,
		windowsSandbox: "elevated",
	},
	cwd,
	authorize,
	lifetime.signal,
);
await assert.rejects(
	tool.execute(
		"reject",
		{ agent: "scout", task: "fixture" },
		undefined,
		undefined,
		{ cwd, model: { provider: "local", id: "fixture" } },
	),
	/fixture: declined/,
);
assert.equal(requests, 1);
assert.equal(opened, 0);
await assert.rejects(
	tool.execute(
		"external",
		{ agent: "codex-exec", task: "fixture" },
		undefined,
		undefined,
		{ cwd, model: { provider: "local", id: "fixture" } },
	),
	/非対応/,
);
assert.equal(requests, 1);
assert.equal(opened, 0);
lifetime.abort();
await assert.rejects(
	tool.execute(
		"stopped",
		{ agent: "scout", task: "fixture" },
		undefined,
		undefined,
		{ cwd, model: { provider: "local", id: "fixture" } },
	),
);
assert.equal(requests, 1);
const report = {
	package: metadata.name,
	version: metadata.version,
	cases: [
		"no-automatic-extension-load",
		"definition-only-adapter",
		"declined-before-extension-execution",
		"stopped-before-approval",
		"external-runner-rejected",
	],
	independentChildExecution:
		"disabled: external entry replaced by Host adapter",
};
await writeFile(join(fixture, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
