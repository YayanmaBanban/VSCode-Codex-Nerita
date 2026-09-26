// TOML の依存関係とコンパイル結果を検証し、本文からのコード混入を防ぐ。
import { expect, it } from "vitest";
import {
	validateWorkflow,
	parseWorkflow,
} from "../../src/shared/workflows/definition";
import { compileWorkflow } from "../../src/shared/workflows/compiler";

const step = { id: "start", agent: "worker", task: "task" };
const base = { version: 1, name: "test", outputs: ["start"], steps: [step] };

it("TOML を解析し、依存順へ正規化する", () => {
	const definition = parseWorkflow(
		'version = 1\nname = "test"\noutputs = ["fix"]\n[[steps]]\nid = "fix"\nresume = "start"\ndepends_on = ["start"]\ntask = "{{ start.output }}"\n[[steps]]\nid = "start"\nagent = "worker"\ntask = "begin"',
	);
	expect(definition.steps.map((item) => item.id)).toEqual(["start", "fix"]);
	expect(compileWorkflow(definition)).toContain(
		'resume: results["start"].runId',
	);
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

it("本文は引用されたデータとして生成し、表示グループで実行順を変えない", () => {
	const text = '${process.exit()} ` " \\ \n';
	const script = compileWorkflow({
		...base,
		steps: [{ ...step, task: text }],
	});
	expect(script).toContain(`task: ${JSON.stringify(text)}`);
	expect(
		compileWorkflow({
			...base,
			steps: [{ ...step, task: text, group: "display" }],
		}),
	).toBe(script);
});
