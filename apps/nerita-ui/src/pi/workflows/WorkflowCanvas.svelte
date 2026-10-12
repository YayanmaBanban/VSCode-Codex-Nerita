<script lang="ts">
	// グラフの手動配置を保持し、接続だけを depends_on の編集経路へ返す。

	import type { Workflow } from "@nerita/shared/workflows/definition";
	import {
		Background,
		Controls,
		SvelteFlow,
		type Connection,
		type Edge,
		type Node,
	} from "@xyflow/svelte";
	import "@xyflow/svelte/dist/style.css";
	import WorkflowNode from "./WorkflowNode.svelte";
	import WorkflowNarrowFocus from "./WorkflowNarrowFocus.svelte";

	let {
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
	} = $props();
	const nodeTypes = { step: WorkflowNode };
	let positions = $state.raw<Node[]>([]);
	let nodes = $derived(positionWorkflowNodes(workflow, positions, selected));
	let edges = $derived(workflowEdges(workflow));

	import {
		workflowEdges,
		positionWorkflowNodes,
	} from "./workflowCanvasModel";
</script>

<div class="workflow-canvas h-full min-h-72" aria-label="Workflow グラフ">
	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		onnodeclick={({ node }) => select(node.id)}
		onnodedragstop={() => {
			positions = nodes;
		}}
		onconnect={connect}
		ondelete={({ edges }) => disconnect(edges)}
		fitView
		fitViewOptions={{ minZoom: 1, maxZoom: 1 }}
		minZoom={0.4}
		maxZoom={1.5}
		colorMode="system"
	>
		<Background />
		<WorkflowNarrowFocus {selected} />
		<Controls showLock={false} />
	</SvelteFlow>
</div>
