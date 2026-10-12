<!-- 専用表示のないツールの元データを文字列として表示する。 -->
<script lang="ts">
	import type { ToolSummary } from "@nerita/shared/chatState";
	import Value from "./Value.svelte";
	let {
		tool,
		scrollable = false,
	}: { tool: ToolSummary; scrollable?: boolean } = $props();
</script>

<Value value={tool.rawItem ?? tool} {scrollable} />
