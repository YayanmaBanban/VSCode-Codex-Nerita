// グラフ操作を TOML の依存関係へ変換し、削除で参照切れを隠さない。
import type {
	Workflow,
	WorkflowStep,
} from "../../../shared/workflows/definition";

/** 既存 ID と重複しない最小の番号を選ぶ。 */
export function nextStep(workflow: Workflow): WorkflowStep {
	let index = 1;
	while (workflow.steps.some((step) => step.id === `step${index}`)) {
		index++;
	}
	return {
		id: `step${index}`,
		agent: "worker",
		task: "タスクを入力してください",
		depends_on: [],
	};
}

/** 接続時には重複・自己参照・循環を拒否する。 */
export function connectSteps(
	workflow: Workflow,
	source: string,
	target: string,
): Workflow {
	const steps = new Map(workflow.steps.map((step) => [step.id, step]));
	if (!steps.has(source) || !steps.has(target) || source === target) {
		throw new Error("接続先が不正です。");
	}
	const pending = [source];
	const visited = new Set<string>();
	while (pending.length) {
		const id = pending.pop()!;
		if (id === target) {
			throw new Error("依存関係が循環する接続は追加できません。");
		}
		if (visited.has(id)) {
			continue;
		}
		visited.add(id);
		pending.push(...(steps.get(id)?.depends_on ?? []));
	}
	return {
		...workflow,
		steps: workflow.steps.map((step) =>
			step.id === target
				? {
						...step,
						depends_on: [...new Set([...step.depends_on, source])],
					}
				: step,
		),
	};
}

/** 参照されているステップは先に参照を変更してから削除する。 */
export function removeStep(workflow: Workflow, id: string): Workflow {
	if (workflow.steps.length === 1) {
		throw new Error("ステップは 1 件以上必要です。");
	}
	const referenced = workflow.steps.some(
		(step) =>
			step.id !== id &&
			(step.resume === id ||
				step.fork === id ||
				new RegExp(`\\{\\{\\s*${id}\\.output\\s*\\}\\}`).test(
					step.task,
				)),
	);
	if (referenced) {
		throw new Error(
			"会話または結果が参照されています。参照を変更してから削除してください。",
		);
	}
	return {
		...workflow,
		outputs: workflow.outputs.filter((output) => output !== id),
		steps: workflow.steps
			.filter((step) => step.id !== id)
			.map((step) => ({
				...step,
				depends_on: step.depends_on.filter((dep) => dep !== id),
			})),
	};
}

/** ID の変更に合わせて、依存・出力・会話・結果の参照を更新する。 */
export function renameStep(
	workflow: Workflow,
	source: string,
	target: string,
): Workflow {
	if (
		!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(target) ||
		workflow.steps.some((step) => step.id === target && step.id !== source)
	) {
		throw new Error(
			"ステップ ID は重複しない英字から始まる名前にしてください。",
		);
	}
	const rename = (id: string) => (id === source ? target : id);
	return {
		...workflow,
		outputs: workflow.outputs.map(rename),
		steps: workflow.steps.map((step) => ({
			...step,
			id: rename(step.id),
			depends_on: step.depends_on.map(rename),
			...(step.resume ? { resume: rename(step.resume) } : {}),
			...(step.fork ? { fork: rename(step.fork) } : {}),
			task: step.task.replace(
				/\{\{\s*([A-Za-z][A-Za-z0-9_-]*)\.output\s*\}\}/g,
				(match: string, id: string) =>
					id === source ? `{{ ${target}.output }}` : match,
			),
		})),
	};
}
