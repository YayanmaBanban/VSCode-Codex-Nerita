// グラフの表示用配置と接続を、文書の実行定義から計算する。
import { Position, type Node, type Edge } from "@xyflow/svelte";
import type { Workflow } from "@nerita/shared/workflows/definition";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
/** 会話の継承方法をノードの短い表示文言へ変換する。 */
export function contextLabel(step: Workflow["steps"][number]) {
	if (isNonEmptyString(step.fork)) {
		return `Fork: ${step.fork}`;
	}
	return isNonEmptyString(step.resume) ? "Resume" : "Fresh";
}
/** 依存の段数から配置を計算し、循環した不完全な入力でも計算を終了する。 */
export function nodesFor(workflow: Workflow): Node[] {
	const levels = new Map<string, number>();
	for (let pass = 0; pass < workflow.steps.length; pass++) {
		for (const step of workflow.steps) {
			const matchesHas =
				!levels.has(step.id) &&
				step.depends_on.every((id) => levels.has(id));
			if (matchesHas) {
				levels.set(
					step.id,
					Math.max(
						-1,
						...step.depends_on.map((id) => levels.get(id)!),
					) + 1,
				);
			}
		}
	}
	const rows = new Map<number, number>();
	return workflow.steps.map((step) => {
		const level = levels.get(step.id) ?? 0;
		const row = rows.get(level) ?? 0;
		rows.set(level, row + 1);
		return {
			id: step.id,
			deletable: false,
			type: "step",
			position: { x: level * 240, y: row * 150 },
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
			data: {
				id: step.id,
				agent: step.agent ?? `↳ ${step.resume}`,
				context: contextLabel(step),
				output: workflow.outputs.includes(step.id),
			},
		};
	});
}
/** 保存する `depends_on` だけから表示用の接続線を組み立てる。 */
export function workflowEdges(workflow: Workflow): Edge[] {
	return workflow.steps.flatMap((step) =>
		step.depends_on.map((dep) => ({
			id: `${dep}:${step.id}`,
			source: dep,
			target: step.id,
		})),
	);
}
/** 定義を編集してもユーザーが動かした位置と選択状態を保持する。 */
export function positionWorkflowNodes(
	workflow: Workflow,
	previous: Node[],
	selected: string,
): Node[] {
	return nodesFor(workflow).map((node) => ({
		...node,
		position:
			previous.find((item) => item.id === node.id)?.position ??
			node.position,
		selected: node.id === selected,
	}));
}
