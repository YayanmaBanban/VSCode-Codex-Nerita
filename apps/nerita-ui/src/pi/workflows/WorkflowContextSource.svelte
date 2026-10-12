<script lang="ts">
	// 編集対象の値と操作を、親の文書状態から受け取る。

	import { type WorkflowContextSourceProps } from "./WorkflowStepFormParts";

	let {
		source,
		switchMode,
		mode,
		workflow,
		step,
	}: WorkflowContextSourceProps = $props();
</script>

<label
	>会話の継承元
	<select
		value={source}
		onchange={(event) => switchMode(mode, event.currentTarget.value)}
		><option value="" disabled
			>選択してください
		</option>{#each workflow.steps.filter((item) => item.id !== step.id) as item (item.id)}
			<option value={item.id}>{item.id}</option>
		{/each}</select
	></label
>
