// 実パッケージの静的検証と Worker で、依存実行・結果参照・継続を確認する。
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
await build({
	entryPoints: ["src/shared/workflows/compiler.ts"],
	outfile: "dist/workflow-compiler.cjs",
	bundle: true,
	platform: "node",
	format: "cjs",
});
const { compileWorkflow } = createRequire(import.meta.url)(
	"../dist/workflow-compiler.cjs",
);
const root =
	process.env.NERITA_SUBAGENTS_PACKAGE ??
	join(homedir(), ".pi/agent/npm/node_modules/pi-subagents");
const engine = await import(
	pathToFileURL(join(root, "src/workflows/scripted-workflow.js")).href
);
const script = compileWorkflow({
	version: 1,
	name: "test",
	outputs: ["fix"],
	steps: [
		{ id: "start", agent: "worker", task: "literal ${process.exit()}" },
		{
			id: "review",
			agent: "reviewer",
			depends_on: ["start"],
			task: "review {{ start.output }}",
		},
		{
			id: "fix",
			resume: "start",
			depends_on: ["start", "review"],
			task: "fix {{ review.output }}",
		},
	],
});
assert.deepEqual(engine.validateWorkflowScript(script), {
	ok: true,
	errors: [],
});
const calls = [];
const result = await engine.runWorkflowScript({
	script,
	signal: new AbortController().signal,
	timeoutMs: 5000,
	globalConcurrencyLimit: 2,
	launch: async (key, params) => {
		calls.push([key, params]);
		return { key, runId: key, ok: true, output: key, artifactPaths: [] };
	},
	status: async () => {
		throw new Error("unexpected status");
	},
});
assert.equal(result.value.fix.output, "fix");
assert.equal(calls[1][1].task, "review start");
assert.equal(calls[2][1].resume, "start");

// 無関係な遅い枝を待たず、依存先が完了した後続を起動する。
const dag = compileWorkflow({
	version: 1,
	name: "dag",
	outputs: ["next"],
	steps: [
		{ id: "slow", agent: "worker", task: "slow" },
		{ id: "fast", agent: "worker", task: "fast" },
		{ id: "next", agent: "worker", depends_on: ["fast"], task: "next" },
	],
});
let release;
const slow = new Promise((resolve) => {
	release = resolve;
});
const order = [];
await engine.runWorkflowScript({
	script: dag,
	timeoutMs: 5000,
	globalConcurrencyLimit: 2,
	launch: async (key) => {
		order.push(key);
		if (key === "slow") {
			await slow;
		}
		if (key === "next") {
			release();
		}
		return { key, runId: key, ok: true, output: key, artifactPaths: [] };
	},
	status: async () => {
		throw new Error("unexpected status");
	},
});
assert.deepEqual(order, ["slow", "fast", "next"]);

// 失敗したステップの後続は起動せず、Worker の取消しも Host の起動へ伝える。
const failure = compileWorkflow({
	version: 1,
	name: "failure",
	outputs: ["next"],
	steps: [
		{ id: "first", agent: "worker", task: "first" },
		{ id: "next", agent: "worker", depends_on: ["first"], task: "next" },
	],
});
let launches = 0;
await assert.rejects(
	engine.runWorkflowScript({
		script: failure,
		timeoutMs: 5000,
		launch: async () => {
			launches++;
			throw new Error("declined");
		},
		status: async () => {
			throw new Error("unexpected status");
		},
	}),
);
assert.equal(launches, 1);
const abort = new AbortController();
let cancelled = false;
await assert.rejects(
	engine.runWorkflowScript({
		script: failure,
		signal: abort.signal,
		timeoutMs: 5000,
		launch: (_key, _params, signal) =>
			new Promise((_resolve, reject) => {
				signal.addEventListener(
					"abort",
					() => {
						cancelled = true;
						reject(new Error("stopped"));
					},
					{ once: true },
				);
				abort.abort();
			}),
		status: async () => {
			throw new Error("unexpected status");
		},
	}),
);
assert.equal(cancelled, true);
console.log(
	"workflow engine: validate, execute, output references, resume passed",
);
