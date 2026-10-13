<script lang="ts">
	// ワークフローの名前・同時実行数・制限時間を編集し、変更を親へ伝える。

	import { type WorkflowSettingsProps } from "./WorkflowGraphEditorParts";

	let { workflow, update }: WorkflowSettingsProps = $props();
</script>

<details class="mb-5">
	<summary class="mb-3 cursor-pointer font-semibold"
		>ワークフロー設定
	</summary>
	<div class="flex flex-col gap-3">
		<label
			>名前
			<input
				value={workflow.name}
				maxlength={80}
				oninput={(event) =>
					update({
						...workflow,
						name: event.currentTarget.value,
					})}
			/></label
		>
		<div class="grid grid-cols-2 gap-2">
			<label
				>同時実行数
				<input
					type="number"
					min={1}
					max={4}
					value={workflow.limits.max_concurrency}
					oninput={(event) =>
						update({
							...workflow,
							limits: {
								...workflow.limits,
								max_concurrency: Number(
									event.currentTarget.value,
								),
							},
						})}
				/></label
			><label
				>制限時間（秒）
				<input
					type="number"
					min={1}
					max={3600}
					value={workflow.limits.timeout_ms / 1000}
					oninput={(event) =>
						update({
							...workflow,
							limits: {
								...workflow.limits,
								timeout_ms:
									Number(event.currentTarget.value) * 1000,
							},
						})}
				/></label
			>
		</div>
	</div>
</details>
