<!-- ステップの追加・選択・接続をグラフで操作し、定義の更新を親へ伝える。 -->
<script lang="ts">
	import type { Connection, Edge } from "@xyflow/svelte";

	import { cn } from "cnfast";

	import WorkflowCanvas from "./WorkflowCanvas.svelte";

	import { connectSteps, nextStep } from "./workflowModel";

	import {
		type WorkflowGraphPaneProps,
		disconnectWorkflowSteps,
	} from "./WorkflowGraphEditorParts";

	let {
		workflow,
		update,
		setSelected,
		step,
		attempt,
	}: WorkflowGraphPaneProps = $props();
</script>

<div class="flex min-h-0 flex-col">
	<div
		class={cn(
			"flex flex-wrap items-center gap-3 border-b border-[var(--workflow-border)]",
			"p-3",
		)}
	>
		<button
			disabled={workflow.steps.length >= 32}
			onclick={() => {
				const next = nextStep(workflow);
				update({
					...workflow,
					steps: [...workflow.steps, next],
				});
				setSelected(next.id);
			}}
			>＋ ステップを追加
		</button><label class="workflow-inline"
			>選択
			<select
				value={step.id}
				onchange={(event) => setSelected(event.currentTarget.value)}
				>{#each workflow.steps as item (item.id)}
					<option value={item.id}>{item.id}</option>
				{/each}</select
			></label
		><span class="text-xs opacity-70"
			>右の端子から次のステップの左端子へ接続
		</span>
	</div>
	<div class="min-h-72 flex-1">
		<WorkflowCanvas
			{workflow}
			selected={step.id}
			select={setSelected}
			connect={(connection: Connection) =>
				attempt(() =>
					update(
						connectSteps(
							workflow,
							connection.source,
							connection.target,
						),
					),
				)}
			disconnect={(edges: Edge[]) =>
				update({
					...workflow,
					steps: disconnectWorkflowSteps(workflow, edges),
				})}
		/>
	</div>
</div>
