// 検証済みの依存関係を JavaScript へ変換し、文字列をコードとして解釈させない。
import {
	outputReferences,
	validateWorkflow,
	type WorkflowStep,
} from "./definition";

/** 各ステップの依存だけを待ち、無関係な枝をまとめて待たない。 */
export function compileWorkflow(value: unknown): string {
	const definition = validateWorkflow(value);
	const names = new Map(
		definition.steps.map((step, index) => [step.id, `p${index}`]),
	);
	const lines = definition.steps.map((step) => {
		const dependencies = step.depends_on
			.map((dep) => names.get(dep))
			.join(",");
		const fields = [`task: ${taskExpression(step)}`];
		if (step.agent) {
			fields.push(`agent: ${JSON.stringify(step.agent)}`);
		}
		if (step.resume) {
			fields.push(
				`resume: results[${JSON.stringify(step.resume)}].runId`,
			);
		}
		if (step.fork) {
			fields.push(
				`neritaFork: results[${JSON.stringify(step.fork)}].runId`,
			);
		}
		// fork はコンパイル済みのステップ ID から Host が解決する。任意の runId は受け付けない。
		return `const ${names.get(step.id)} = Promise.all([${dependencies}]).then(() => runs.run(${JSON.stringify(step.id)}, {${fields.join(",")}})).then(result => { if (!result.ok) throw new Error(result.error || "Step failed"); results[${JSON.stringify(step.id)}] = result; return result; });`;
	});
	lines.unshift("const results = Object.create(null);");
	lines.push(
		`const settled = await Promise.allSettled([${[...names.values()].join(",")}]);`,
	);
	lines.push(
		'const failed = settled.find(item => item.status === "rejected"); if (failed) throw failed.reason;',
	);
	lines.push(
		`return {${definition.outputs.map((id) => `${JSON.stringify(id)}: await ${names.get(id)}`).join(",")}};`,
	);
	return lines.join("\n");
}

/** ユーザー本文と出力参照を分離し、引用符・改行・テンプレート構文もデータとして生成する。 */
function taskExpression(step: WorkflowStep) {
	let start = 0;
	const parts: string[] = [];
	for (const match of outputReferences(step.task)) {
		parts.push(
			JSON.stringify(step.task.slice(start, match.index)),
			`results[${JSON.stringify(match[1]!)}].output`,
		);
		start = match.index + match[0].length;
	}
	parts.push(JSON.stringify(step.task.slice(start)));
	return parts.join(" + ");
}
