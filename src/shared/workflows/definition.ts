// TOML と将来のエディタが共有する定義を検証し、依存順へ正規化する。
import { z } from "zod";
import { parse } from "smol-toml";

const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const stepSchema = z
	.object({
		id,
		agent: z.string().min(1).max(80).optional(),
		task: z.string().min(1).max(32768),
		depends_on: z.array(id).max(32).default([]),
		group: z.string().max(80).optional(),
		resume: id.optional(),
		fork: id.optional(),
	})
	.strict();
export const workflowSchema = z
	.object({
		version: z.literal(1),
		name: z.string().min(1).max(80),
		outputs: z.array(id).min(1).max(32),
		limits: z
			.object({
				max_concurrency: z.number().int().min(1).max(4).default(3),
				timeout_ms: z
					.number()
					.int()
					.min(1000)
					.max(3600000)
					.default(600000),
			})
			.strict()
			.prefault({}),
		steps: z.array(stepSchema).min(1).max(32),
	})
	.strict();
/** 表示設定は依存順と子の実行条件へ影響しない。 */
export type Workflow = z.infer<typeof workflowSchema>;
export type WorkflowStep = Workflow["steps"][number];

/** 任意の式を認めず、結果参照の構文だけを解析する。 */
export function outputReferences(task: string) {
	const pattern = /\{\{\s*([A-Za-z][A-Za-z0-9_-]{0,63})\.output\s*\}\}/g;
	const refs = [...task.matchAll(pattern)];
	if (/\{\{|\}\}/.test(task.replace(pattern, ""))) {
		throw new Error("結果参照は {{ step.output }} だけを使用できます。");
	}
	return refs;
}

/** 未知の項目や式を黙って無視せず、実行前に拒否する。 */
export function parseWorkflow(text: string): Workflow {
	if (text.length > 262144) {
		throw new Error("ワークフロー定義が上限を超えています。");
	}
	return validateWorkflow(parse(text));
}

/** 全ステップを検証してから並び替え、ファイル記述順への依存をなくす。 */
export function validateWorkflow(value: unknown): Workflow {
	const definition = workflowSchema.parse(value);
	const steps = new Map(definition.steps.map((step) => [step.id, step]));
	if (steps.size !== definition.steps.length) {
		throw new Error("ステップ ID が重複しています。");
	}
	for (const step of steps.values()) {
		validateStep(step, steps);
	}
	for (const output of definition.outputs) {
		if (!steps.has(output)) {
			throw new Error(`出力先がありません: ${output}`);
		}
	}
	const ordered: WorkflowStep[] = [];
	while (ordered.length < steps.size) {
		const ready = [...steps.values()].filter(
			(step) =>
				!ordered.includes(step) &&
				step.depends_on.every((dep) =>
					ordered.some((item) => item.id === dep),
				),
		);
		if (!ready.length) {
			throw new Error("依存関係が循環しています。");
		}
		ordered.push(...ready);
	}
	return { ...definition, steps: ordered };
}

/** 継続元は先行する依存先とし、同じ完了時点からの二重再開を禁止する。 */
function validateStep(step: WorkflowStep, steps: Map<string, WorkflowStep>) {
	validateMode(step);
	validateReferences(step, steps);
	if (
		step.resume &&
		[...steps.values()].filter((other) => other.resume === step.resume)
			.length > 1
	) {
		throw new Error(`同じ完了時点から二重に再開できません: ${step.resume}`);
	}
}

/** 新規・複製・継続の指定を相互に矛盾させない。 */
function validateMode(step: WorkflowStep) {
	if (step.resume && (step.fork || step.agent)) {
		throw new Error("resume は agent・fork と併用できません。");
	}
	if (!step.resume && !step.agent) {
		throw new Error(`agent がありません: ${step.id}`);
	}
}

/** 結果と会話の参照先は明示された依存関係に含める。 */
function validateReferences(
	step: WorkflowStep,
	steps: Map<string, WorkflowStep>,
) {
	const required = [
		...step.depends_on,
		...outputReferences(step.task).map((match) => match[1]!),
		...[step.resume, step.fork].filter((ref) => ref !== undefined),
	];
	for (const ref of required) {
		if (
			ref === step.id ||
			!steps.has(ref) ||
			!ancestors(step, steps).has(ref)
		) {
			throw new Error(`依存先が不正です: ${step.id} → ${ref}`);
		}
	}
}

/** 推移的な依存も認めるが、循環をたどり続けない。 */
function ancestors(step: WorkflowStep, steps: Map<string, WorkflowStep>) {
	const pending = [...step.depends_on];
	const found = new Set<string>();
	while (pending.length) {
		const id = pending.pop()!;
		if (found.has(id)) {
			continue;
		}
		found.add(id);
		pending.push(...(steps.get(id)?.depends_on ?? []));
	}
	return found;
}
