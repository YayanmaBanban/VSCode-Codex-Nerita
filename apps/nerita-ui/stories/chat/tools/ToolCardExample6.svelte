<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import ToolCard from "../../../src/chat/tools/ToolCard.svelte";
	import "../../../src/chat/chat.css";
</script>

<main style:padding="16px">
	<ToolCard
		tool={{
			id: "structured",
			title: "項目数を取得",
			kind: "other",
			status: "completed",
			paths: [],
			resultDisplay: {
				source: "structuredContent",
				omitted: true,
			},
			content: [
				{
					type: "content",
					content: {
						type: "text",
						text: '{\n  "count": 3,\n  "html": "<script>window.unsafeResult = true\u003c/script>",\n  "private": "[非公開]"\n}\n[表示上限または非公開情報のため、一部を省略しました。]',
					},
				},
			],
		}}
	></ToolCard>
</main>
