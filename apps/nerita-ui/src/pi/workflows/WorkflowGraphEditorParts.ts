// 表示用の型と文書変換を共有し、各入力欄では状態を複製しない。

import { type Workflow } from "@nerita/shared/workflows/definition";

import { type Edge } from "@xyflow/svelte";

/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type WorkflowGraphEditorProps = {
	initial: Workflow;
	text: string;
	change: (text: string) => void;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type WorkflowGraphPaneProps = {
	workflow: Workflow;
	update: (value: Workflow) => void;
	setSelected: (value: string) => void;
	step: Workflow["steps"][number];
	attempt: (operation: () => void) => void;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export function disconnectWorkflowSteps(
	workflow: Workflow,
	edges: Edge[],
): Workflow["steps"][number][] {
	return workflow.steps.map((item) => ({
		...item,
		depends_on: item.depends_on.filter(
			(dep) => !workflowEdgeExists(edges, dep, item.id),
		),
	}));
}
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type WorkflowInspectorProps = {
	workflow: Workflow;
	update: (value: Workflow) => void;
	step: Workflow["steps"][number];
	attempt: (operation: () => void) => void;
	setSelected: (value: string) => void;
	error: string;
	validation: string;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type WorkflowSettingsProps = {
	workflow: Workflow;
	update: (value: Workflow) => void;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export function workflowEdgeExists(
	edges: Edge[],
	source: string,
	target: string,
) {
	const matchesSome = edges.some(
		(edge) => edge.source === source && edge.target === target,
	);
	return matchesSome;
}
