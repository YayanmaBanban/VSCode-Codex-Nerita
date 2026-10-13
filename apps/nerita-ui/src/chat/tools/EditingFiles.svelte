<!-- 差分がパスを表示する場合は共通のパス一覧を省き、編集結果を表示する。 -->
<script lang="ts">
	import ToolContent from "./ToolContent.svelte";
	import type { ToolContentProps } from "./toolContentProps";

	let { tool, send, cwd }: ToolContentProps = $props();
	const visibleTool = $derived({
		...tool,
		paths:
			tool.content?.some(
				(value) =>
					value.type === "diff" || value.type === "unifiedDiff",
			) === true
				? []
				: tool.paths,
	});
</script>

<ToolContent tool={visibleTool} {send} {cwd} />
