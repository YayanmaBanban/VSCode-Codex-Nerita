// 表示用の型と文書変換を共有し、各入力欄では状態を複製しない。

import {
	type Workflow,
	type WorkflowStep,
} from "@nerita/shared/workflows/definition";

/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export function contextMode(step: WorkflowStep): "resume" | "fork" | "fresh" {
	if (step.resume !== undefined) {
		return "resume";
	}
	return step.fork !== undefined ? "fork" : "fresh";
}
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type WorkflowStepFormProps = {
	step: WorkflowStep;
	workflow: Workflow;
	change: (step: WorkflowStep) => void;
	rename: (id: string) => void;
	remove: () => void;
	output: (checked: boolean) => void;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type WorkflowContextSourceProps = {
	source: string;
	switchMode: (value: string, ref?: string) => void;
	mode: "resume" | "fork" | "fresh";
	workflow: Workflow;
	step: WorkflowStep;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type WorkflowStepGroupProps = {
	step: WorkflowStep;
	change: (step: WorkflowStep) => void;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
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
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type WorkflowContextModeProps = {
	mode: "resume" | "fork" | "fresh";
	switchMode: (value: string, ref?: string) => void;
	workflow: Workflow;
	step: WorkflowStep;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type WorkflowDependenciesProps = {
	workflow: Workflow;
	step: WorkflowStep;
	change: (step: WorkflowStep) => void;
};
