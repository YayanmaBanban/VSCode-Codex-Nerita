<!-- 推論ツールに含まれる Markdown 本文だけを表示する。 -->
<script lang="ts">
	import type { ToolSummary } from "@nerita/shared/chatState";
	import MessageText from "../messages/MessageText.svelte";
	let { tool }: { tool: ToolSummary } = $props();
</script>

{#each tool.content ?? [] as value, index (index)}{#if value.type === "content" && value.content.text !== ""}<MessageText
			text={value.content.text}
		/>{/if}{/each}
