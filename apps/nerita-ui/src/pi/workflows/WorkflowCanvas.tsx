// React Flow の配置は表示だけに使い、接続線を `depends_on` として扱う。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";

import type { Workflow } from "@nerita/shared/workflows/definition";
import {
	Background,
	Controls,
	Position,
	ReactFlow,
	applyEdgeChanges,
	applyNodeChanges,
	useNodesInitialized,
	useReactFlow,
	type Connection,
	type Edge,
	type Node,
	type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useState } from "react";

/** 会話の扱いをノード内の短い表記にする。 */
function contextLabel(step: Workflow["steps"][number]) {
	if (isNonEmptyString(step.fork)) {
		return `Fork: ${step.fork}`;
	}
	return isNonEmptyString(step.resume) ? "Resume" : "Fresh";
}

/** 依存関係の段数に沿って配置し、編集中の定義に循環があっても配置計算を終了する。 */
function nodesFor(workflow: Workflow): Node[] {
	const levels = new Map<string, number>();
	for (let pass = 0; pass < workflow.steps.length; pass++) {
		for (const step of workflow.steps) {
			if (
				!levels.has(step.id) &&
				step.depends_on.every((id) => levels.has(id))
			) {
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
			position: { x: level * 240, y: row * 150 },
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
			data: {
				label: (
					<div className="text-left">
						<div className="font-semibold">{step.id}</div>
						<div className="mt-1 opacity-75">
							{step.agent ?? `↳ ${step.resume}`}
						</div>
						<div className="mt-2 text-xs opacity-65">
							{contextLabel(step)}
							{workflow.outputs.includes(step.id)
								? " · 出力"
								: ""}
						</div>
					</div>
				),
			},
		};
	});
}

/** ワークフロー定義と選択中のステップ、ノード選択・線の接続や削除の操作。 */
type WorkflowCanvasProps = {
	workflow: Workflow;
	selected: string;
	select: (id: string) => void;
	connect: (connection: Connection) => void;
	disconnect: (edges: Edge[]) => void;
};

/** ノードの選択・接続・線の削除をフォームと同じ編集経路へ返す。 */
export function WorkflowCanvas({
	workflow,
	selected,
	select,
	connect,
	disconnect,
}: WorkflowCanvasProps) {
	const [nodes, setNodes] = useState(() => nodesFor(workflow));
	useEffect(() => {
		setNodes((previous) =>
			positionWorkflowNodes(workflow, previous, selected),
		);
	}, [workflow, selected]);
	const [edges, setEdges] = useState<Edge[]>([]);
	useEffect(() => {
		setEdges(workflowEdges(workflow));
	}, [workflow]);
	return (
		<div
			className="workflow-canvas h-full min-h-72"
			aria-label="Workflow グラフ"
		>
			<ReactFlow
				nodes={nodes}
				edges={edges}
				onNodesChange={(changes) =>
					setNodes((current) =>
						applyEditableNodeChanges(changes, current),
					)
				}
				onNodeClick={(_event, node) => select(node.id)}
				onConnect={connect}
				onEdgesDelete={disconnect}
				onEdgesChange={(changes) =>
					setEdges((current) => applyEdgeChanges(changes, current))
				}
				fitView
				fitViewOptions={{ minZoom: 1, maxZoom: 1 }}
				minZoom={0.4}
				maxZoom={1.5}
				colorMode="system"
			>
				<Background />
				<NarrowFocus selected={selected} />
				<Controls showInteractive={false} />
			</ReactFlow>
		</div>
	);
}

/** ノードの削除を除き、グラフ上の配置変更を反映する。 */
function applyEditableNodeChanges(
	changes: NodeChange<Node>[],
	current: Node[],
): Node[] {
	return applyNodeChanges(
		changes.filter((change) => change.type !== "remove"),
		current,
	);
}

/** 依存先からグラフの接続線を生成する。 */
function workflowEdges(workflow: Workflow): Edge[] {
	return workflow.steps.flatMap((step) =>
		step.depends_on.map((dep) => ({
			id: `${dep}:${step.id}`,
			source: dep,
			target: step.id,
		})),
	);
}

/** 再描画時も既存ノードの手動配置を保つ。 */
function positionWorkflowNodes(
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

/** 狭いパネルで中央に表示するステップの識別子。 */
type NarrowFocusProps = { selected: string };

/** 狭いパネルでは選択したノードを読める倍率で中央へ表示する。 */
function NarrowFocus({ selected }: NarrowFocusProps) {
	const { fitView } = useReactFlow();
	const initialized = useNodesInitialized();
	useEffect(() => {
		if (!initialized || !window.matchMedia("(max-width: 720px)").matches) {
			return;
		}
		const frame = requestAnimationFrame(() => {
			void fitView({ nodes: [{ id: selected }], minZoom: 1, maxZoom: 1 });
		});
		return () => cancelAnimationFrame(frame);
	}, [selected, initialized, fitView]);
	return null;
}
