// TOML の依存関係とコンパイル結果を検証し、本文からのコード混入を防ぐ。
import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import {
	validateWorkflow,
	parseWorkflow,
} from "@nerita/shared/workflows/definition";
import { compileWorkflow } from "@nerita/shared/workflows/compiler";

const step = { id: "start", agent: "worker", task: "task" };
const base = { version: 1, name: "test", outputs: ["start"], steps: [step] };

/** 生成コードを実行し、子起動の入力と最終結果を観測する。 */
async function execute(value: unknown) {
	const calls: { key: string; params: Record<string, unknown> }[] = [];
	const result: unknown = await runInNewContext(
		`(async () => { ${compileWorkflow(value)} })()`,
		{
			runs: {
				run: (key: string, params: Record<string, unknown>) => {
					calls.push({ key, params });
					return Promise.resolve({
						ok: true,
						runId: `run-${key}`,
						output: `output-${key}`,
					});
				},
			},
		},
		{ timeout: 1000 },
	);
	return { calls, result };
}

it("後置した依存ステップを先に実行し、その出力と継続 ID を次の子へ渡す", async () => {
	const definition = parseWorkflow(
		'version = 1\nname = "test"\noutputs = ["fix"]\n[[steps]]\nid = "fix"\nresume = "start"\ndepends_on = ["start"]\ntask = "{{ start.output }}"\n[[steps]]\nid = "start"\nagent = "worker"\ntask = "begin"',
	);
	const execution = await execute(definition);
	expect(execution.calls).toEqual([
		{ key: "start", params: { task: "begin", agent: "worker" } },
		{ key: "fix", params: { task: "output-start", resume: "run-start" } },
	]);
	expect(execution.result).toEqual({
		fix: { ok: true, runId: "run-fix", output: "output-fix" },
	});
});

it.each([
	{ ...base, steps: [step, step] },
	{ ...base, outputs: ["missing"] },
	{ ...base, steps: [{ ...step, depends_on: ["start"] }] },
	{ ...base, steps: [{ ...step, task: "{{ other.output }}" }] },
	{
		...base,
		steps: [{ ...step, task: "{{ start.output || process.exit() }}" }],
	},
	{ ...base, steps: [{ ...step, resume: "other" }] },
	{ ...base, steps: [{ ...step, runner: "external" }] },
	{
		...base,
		steps: [
			{ ...step, depends_on: ["end"] },
			{ ...step, id: "end", depends_on: ["start"] },
		],
	},
])("不正な定義を実行前に拒否する: %j", (value) => {
	expect(() => validateWorkflow(value)).toThrow();
});

it("本文のコードを実行せず、そのまま子へ渡し、表示グループでも結果を変えない", async () => {
	const text = '${process.exit()} ` " \\ \n';
	const execution = await execute({
		...base,
		steps: [{ ...step, task: text }],
	});
	expect(execution.calls).toEqual([
		{ key: "start", params: { task: text, agent: "worker" } },
	]);
	expect(
		await execute({
			...base,
			steps: [{ ...step, task: text, group: "display" }],
		}),
	).toEqual(execution);
});
