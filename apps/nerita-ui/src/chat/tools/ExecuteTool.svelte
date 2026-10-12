<!-- コマンドの整形済み出力を優先し、端末参照や重複した入力を省く。 -->
<script lang="ts">
	import type { ToolSummary } from "@nerita/shared/chatState";
	import CommandOutput from "./CommandOutput.svelte";
	import ToolContent from "./ToolContent.svelte";
	let { tool }: { tool: ToolSummary } = $props();
	const visibleTool = $derived({
		...tool,
		rawInput: undefined,
		content: (tool.content ?? []).filter(
			(value) => value.type !== "terminal",
		),
	});
</script>

{#if typeof tool.commandOutput === "string"}<CommandOutput
		text={tool.commandOutput}
	/>{:else}<ToolContent tool={visibleTool} scrollable />{/if}
