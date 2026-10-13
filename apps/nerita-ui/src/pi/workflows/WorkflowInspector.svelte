<!-- 選択ステップとワークフロー全体の設定を編集し、検証結果と操作エラーを表示する。 -->
<script lang="ts">
	import type { Workflow } from "@nerita/shared/workflows/definition";

	import {
		isNonEmptyString,
		nonEmptyString,
	} from "@nerita/shared/valuePredicates";

	import { cn } from "cnfast";

	import { removeStep, renameStep } from "./workflowModel";

	import WorkflowStepForm from "./WorkflowStepForm.svelte";

	import { type WorkflowInspectorProps } from "./WorkflowGraphEditorParts";

	import WorkflowSettings from "./WorkflowSettings.svelte";

	let {
		workflow,
		update,
		step,
		attempt,
		setSelected,
		error,
		validation,
	}: WorkflowInspectorProps = $props();
</script>

<aside
	class={cn(
		"workflow-inspector min-h-0 overflow-auto border-l",
		"border-[var(--workflow-border)] p-4",
	)}
>
	<WorkflowSettings {...{ workflow, update }} />{#key step.id}
		<WorkflowStepForm
			{step}
			{workflow}
			change={(next: Workflow["steps"][number]) =>
				update({
					...workflow,
					steps: workflow.steps.map((item) =>
						item.id === step.id ? next : item,
					),
				})}
			rename={(id: string) =>
				attempt(() => {
					update(renameStep(workflow, step.id, id));
					setSelected(id);
				})}
			remove={() => attempt(() => update(removeStep(workflow, step.id)))}
			output={(checked: boolean) =>
				update({
					...workflow,
					outputs: checked
						? [...workflow.outputs, step.id]
						: workflow.outputs.filter((id) => id !== step.id),
				})}
		/>
	{/key}{#if isNonEmptyString(error) || isNonEmptyString(validation)}
		<p
			role="alert"
			class="mt-4 break-words whitespace-pre-wrap text-tool-error"
		>
			{nonEmptyString(error) ?? validation}
		</p>
	{/if}
</aside>
