<!-- 描画後の引数変更を、Controls と同じ親からの props 更新で再現する。 -->
<script lang="ts">
	import WorkflowPreview from "./WorkflowPreview.svelte";

	let loading = $state(false);
	let running = $state(false);
	let invalid = $state(false);
</script>

<div class="flex flex-wrap gap-3 p-2 text-primary-text">
	<label><input type="checkbox" bind:checked={loading} />読み込み待ち</label>
	<label><input type="checkbox" bind:checked={running} />実行中</label>
	<label><input type="checkbox" bind:checked={invalid} />不正な定義</label>
</div>
<WorkflowPreview {loading} {running} {invalid} />
