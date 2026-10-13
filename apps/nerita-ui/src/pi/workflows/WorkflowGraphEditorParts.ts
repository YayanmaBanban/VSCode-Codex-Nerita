// グラフと設定欄の入力型を共有し、削除した接続を依存関係へ反映する。

import { type Workflow } from "@nerita/shared/workflows/definition";

import { type Edge } from "@xyflow/svelte";

/** 解析済みの定義と TOML 本文を渡し、グラフ編集の結果を本文へ反映する。 */
export type WorkflowGraphEditorProps = {
	initial: Workflow;
	text: string;
	change: (text: string) => void;
};
/** 定義と選択ステップを渡し、グラフの編集結果と操作エラーを親へ伝える。 */
export type WorkflowGraphPaneProps = {
	workflow: Workflow;
	update: (value: Workflow) => void;
	setSelected: (value: string) => void;
	step: Workflow["steps"][number];
	attempt: (operation: () => void) => void;
};
/** 削除した接続に対応する依存先を各ステップから除き、残りの依存関係を保持する。 */
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
/** 選択ステップの編集操作と、定義の検証結果・操作エラーを設定欄へ渡す。 */
export type WorkflowInspectorProps = {
	workflow: Workflow;
	update: (value: Workflow) => void;
	step: Workflow["steps"][number];
	attempt: (operation: () => void) => void;
	setSelected: (value: string) => void;
	error: string;
	validation: string;
};
/** ワークフロー全体の設定を渡し、名前・同時実行数・制限時間の変更を親へ伝える。 */
export type WorkflowSettingsProps = {
	workflow: Workflow;
	update: (value: Workflow) => void;
};
/** 接続元と接続先の両方に一致する線の有無を確認する。 */
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
