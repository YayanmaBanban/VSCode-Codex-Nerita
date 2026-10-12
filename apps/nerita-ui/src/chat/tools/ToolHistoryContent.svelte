<!-- 保存要約の入力・本文だけを表示し、未保存の結果を補わない。 -->
<script lang="ts">
	import ToolContent from "./ToolContent.svelte";
	import type { ToolContentProps } from "./toolContentProps";
	let { tool, send, cwd }: ToolContentProps = $props();
</script>

{#if tool.rawInput !== undefined || tool.content?.length}<ToolContent
		{tool}
		{send}
		{cwd}
	/>{/if}
