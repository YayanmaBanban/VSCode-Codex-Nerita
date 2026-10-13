<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import ToolCard from "../../../src/chat/tools/ToolCard.svelte";
	import "../../../src/chat/chat.css";
</script>

<main class="p-4">
	<ToolCard
		tool={{
			id: "lazy-diff",
			title: "差分の遅延表示",
			kind: "edit",
			status: "completed",
			paths: [],
			content: [
				{
					type: "diff",
					path: "lazy.txt",
					oldText: "変更前\n",
					newText: "変更後\n",
				},
			],
		}}
	></ToolCard>
	<ToolCard
		tool={{
			id: "lazy-think",
			title: "推論の遅延表示",
			kind: "think",
			status: "completed",
			paths: [],
			content: [
				{
					type: "content",
					content: { type: "text", text: "**推論の本文**" },
				},
			],
		}}
	></ToolCard>
</main>
