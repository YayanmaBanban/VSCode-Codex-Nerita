<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import "../../../src/chat/chat.css";
	import LargeOutputStory from "./ToolCardLargeOutputStory.svelte";
</script>

<LargeOutputStory></LargeOutputStory>
