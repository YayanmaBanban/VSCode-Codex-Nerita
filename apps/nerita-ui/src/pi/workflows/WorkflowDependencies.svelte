<script lang="ts">
	// 編集対象の値と操作を、親の文書状態から受け取る。

	import { type WorkflowDependenciesProps } from "./WorkflowStepFormParts";

	let { workflow, step, change }: WorkflowDependenciesProps = $props();
</script>

<fieldset class="flex flex-col gap-2">
	<legend>先に完了するステップ</legend
	>{#each workflow.steps.filter((item) => item.id !== step.id) as item (item.id)}
		<label class="workflow-check"
			><input
				type="checkbox"
				checked={step.depends_on.includes(item.id)}
				oninput={(event) =>
					change({
						...step,
						depends_on: event.currentTarget.checked
							? [...step.depends_on, item.id]
							: step.depends_on.filter((dep) => dep !== item.id),
					})}
			/>{item.id}</label
		>
	{/each}
</fieldset>
