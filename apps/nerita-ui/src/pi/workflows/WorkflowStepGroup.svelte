<script lang="ts">
	// ステップをまとめる表示用のグループ名を入力し、変更を親へ伝える。

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
