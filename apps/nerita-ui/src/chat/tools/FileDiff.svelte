<!-- 変更前後の本文を時間制限付きで比較し、計算できない場合も本文を残す。 -->
<script lang="ts">
	import DiffView from "./DiffView.svelte";
	import { contentHunks, type DiffLocationProps } from "./diffPresentation";
	import { toolLabelClass, toolOutputClass } from "./toolStyles";

	let {
		oldText,
		newText,
		...location
	}: DiffLocationProps & { oldText: string | null; newText: string } =
		$props();
	const hunks = $derived(
		contentHunks({ type: "diff", path: location.path, oldText, newText }),
	);
</script>

<DiffView {...location} {hunks}>
	{#if !hunks}<p class="text-[12px] text-muted">
			差分の計算が制限時間を超えたため、本文を表示します。
		</p>
		<h3 class={toolLabelClass}>変更前</h3>
		<pre class={toolOutputClass}>{oldText ?? ""}</pre>
		<h3 class={toolLabelClass}>変更後</h3>
		<pre class={toolOutputClass}>{newText}</pre>
	{:else if hunks.length === 0}<p class="text-[12px] text-muted">
			{oldText === null ? "空のファイルを作成" : "変更はありません。"}
		</p>{/if}
</DiffView>
