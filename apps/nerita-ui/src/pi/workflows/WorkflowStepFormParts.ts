// ステップ編集の入力型を共有し、会話の継承方式に合う定義へ変換する。

import {
	type Workflow,
	type WorkflowStep,
} from "@nerita/shared/workflows/definition";

/** 会話の継承設定を表示用の方式へ変換し、継承がなければ新しい会話として扱う。 */
export function contextMode(step: WorkflowStep): "resume" | "fork" | "fresh" {
	if (step.resume !== undefined) {
		return "resume";
	}
	return step.fork !== undefined ? "fork" : "fresh";
}
/** 選択ステップの内容と、ID 変更・削除・出力指定を親へ伝える操作を渡す。 */
export type WorkflowStepFormProps = {
	step: WorkflowStep;
	workflow: Workflow;
	change: (step: WorkflowStep) => void;
	rename: (id: string) => void;
	remove: () => void;
	output: (checked: boolean) => void;
};
/** 継承元の選択に必要なステップ一覧と、会話の継承方式を変更する操作を渡す。 */
export type WorkflowContextSourceProps = {
	source: string;
	switchMode: (value: string, ref?: string) => void;
	mode: "resume" | "fork" | "fresh";
	workflow: Workflow;
	step: WorkflowStep;
};
/** ステップの表示用グループ名と、変更を親へ伝える操作を渡す。 */
export type WorkflowStepGroupProps = {
	step: WorkflowStep;
	change: (step: WorkflowStep) => void;
};
/** 会話の継承方式に合う設定へ切り替え、継承する場合は継承元を依存先にも追加する。 */
export function createContextModeChange(
	source: string,
	step: WorkflowStep,
	change: (step: WorkflowStep) => void,
) {
	return (value: string, ref = source) => {
		const { resume: _resume, fork: _fork, agent: _agent, ...rest } = step;
		const dependency =
			ref !== "" && !rest.depends_on.includes(ref)
				? [...rest.depends_on, ref]
				: rest.depends_on;
		if (value === "resume") {
			change({ ...rest, resume: ref, depends_on: dependency });
		} else if (value === "fork") {
			change({
				...rest,
				agent: step.agent ?? "worker",
				fork: ref,
				depends_on: dependency,
			});
		} else {
			change({ ...rest, agent: step.agent ?? "worker" });
		}
	};
}
/** 会話の継承方式と、継承元の有無に応じた選択操作を渡す。 */
export type WorkflowContextModeProps = {
	mode: "resume" | "fork" | "fresh";
	switchMode: (value: string, ref?: string) => void;
	workflow: Workflow;
	step: WorkflowStep;
};
/** 現在のステップ以外を依存先候補とし、選択の変更を親へ伝える。 */
export type WorkflowDependenciesProps = {
	workflow: Workflow;
	step: WorkflowStep;
	change: (step: WorkflowStep) => void;
};
