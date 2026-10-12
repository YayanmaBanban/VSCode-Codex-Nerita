<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import ToolCard from "../../../src/chat/tools/ToolCard.svelte";
	import "../../../src/chat/chat.css";
</script>

<main style:padding="16px">
	<ToolCard
		tool={{
			id: "unknown-result",
			title: "遠隔の項目を更新",
			kind: "other",
			status: "unknown",
			paths: [],
			resultDisplay: { source: "content", omitted: false },
			content: [
				{
					type: "content",
					content: {
						type: "text",
						text: "MCP 操作の結果は不明です。遠隔処理が完了した可能性があるため、再実行前に結果を確認してください。",
					},
				},
			],
		}}
	></ToolCard>
</main>
