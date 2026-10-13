<!-- 保存された依頼原文を表示し、工程確認とアーカイブを明示的に要求する。 -->
<script lang="ts">
	import type {
		DlcAction,
		DlcProjection,
	} from "@nerita/shared/dlc/contracts";

	let {
		selected,
		action,
	}: { selected: DlcProjection; action: (action: DlcAction) => void } =
		$props();
</script>

<div class="mb-4">
	<h3 class="text-[13px]">作成時の依頼</h3>
	<p class="dlc-request">{selected.request}</p>
	<details class="mb-3">
		<summary>詳細設定</summary>
		<p>実行プロファイル: {selected.profile}</p>
	</details>
	<div class="dlc-toolbar">
		<button
			type="button"
			disabled={selected.workflowStatus !== "in-flight"}
			onclick={() => action({ type: "advance" })}
			>工程の実行条件を確認</button
		>
		<button
			type="button"
			disabled={selected.canCancel ||
				selected.workflowStatus === "archived"}
			onclick={() => action({ type: "archive" })}>アーカイブ</button
		>
	</div>
</div>
