<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import ToolCard from "../../../src/chat/tools/ToolCard.svelte";
	import { longCommandTool } from "../fixtures/toolCommands";
	import "../../../src/chat/chat.css";
</script>

<main class="p-4">
	<ToolCard tool={longCommandTool}></ToolCard>
</main>
