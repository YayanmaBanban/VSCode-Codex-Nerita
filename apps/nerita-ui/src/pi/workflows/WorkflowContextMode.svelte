<script lang="ts">
	// 編集対象の値と操作を、親の文書状態から受け取る。

	import { type WorkflowContextModeProps } from "./WorkflowStepFormParts";

	let { mode, switchMode, workflow, step }: WorkflowContextModeProps =
		$props();
</script>

<label
	>コンテキスト
	<select
		value={mode}
		onchange={(event) =>
			switchMode(
				event.currentTarget.value,
				workflow.steps.find((item) => item.id !== step.id)?.id ?? "",
			)}
		><option value="fresh">Fresh · 新しい会話</option><option
			value="resume"
			disabled={workflow.steps.length < 2}
			>Resume · 会話を継続
		</option><option value="fork" disabled={workflow.steps.length < 2}
			>Fork · 会話を複製
		</option></select
	></label
>
