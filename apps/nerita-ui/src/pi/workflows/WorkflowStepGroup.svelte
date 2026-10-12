<script lang="ts">
	// 編集対象の値と操作を、親の文書状態から受け取る。

	import { type WorkflowStepGroupProps } from "./WorkflowStepFormParts";

	let { step, change }: WorkflowStepGroupProps = $props();
</script>

<label
	>グループ
	<input
		value={step.group ?? ""}
		maxlength={80}
		oninput={(event) =>
			change({ ...step, group: event.currentTarget.value })}
		placeholder="表示用の名前（任意）"
	/></label
>
