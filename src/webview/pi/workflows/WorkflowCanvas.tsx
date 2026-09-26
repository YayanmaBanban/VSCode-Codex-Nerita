// React Flow の配置は表示だけに使い、接続線を depends_on として扱う。
import { useEffect, useState } from "react";
import {
	ReactFlow,
	Background,
	Controls,
	applyNodeChanges,
	applyEdgeChanges,
	type Node,
	type Edge,
	type Connection,
	Position,
	useReactFlow,
	useNodesInitialized,
} from "@xyflow/react";
import type { Workflow } from "../../../shared/workflows/definition";
import "@xyflow/react/dist/style.css";

/** 会話の扱いをノード内の短い表記にする。 */
function contextLabel(step: Workflow["steps"][number]) {
	if (step.fork) {
		return `Fork: ${step.fork}`;
	}
	return step.resume ? "Resume" : "Fresh";
}

/** 依存段数に沿って配置し、循環した編集中の定義でも有限回で終える。 */
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

/** ノードの選択・接続・線の削除をフォームと同じ編集経路へ返す。 */
export function WorkflowCanvas({
	workflow,
	selected,
	select,
	connect,
	disconnect,
}: {
	workflow: Workflow;
	selected: string;
	select: (id: string) => void;
	connect: (connection: Connection) => void;
	disconnect: (edges: Edge[]) => void;
}) {
	const [nodes, setNodes] = useState(() => nodesFor(workflow));
	useEffect(() => {
		setNodes((previous) =>
			nodesFor(workflow).map((node) => ({
				...node,
				position:
					previous.find((item) => item.id === node.id)?.position ??
					node.position,
				selected: node.id === selected,
			})),
		);
	}, [workflow, selected]);
	const [edges, setEdges] = useState<Edge[]>([]);
	useEffect(() => {
		setEdges(
			workflow.steps.flatMap((step) =>
				step.depends_on.map((dep) => ({
					id: `${dep}:${step.id}`,
					source: dep,
					target: step.id,
				})),
			),
		);
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
						applyNodeChanges(
							changes.filter(
								(change) => change.type !== "remove",
							),
							current,
						),
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

/** 狭いパネルでは選択したノードを読める倍率で中央へ表示する。 */
function NarrowFocus({ selected }: { selected: string }) {
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
