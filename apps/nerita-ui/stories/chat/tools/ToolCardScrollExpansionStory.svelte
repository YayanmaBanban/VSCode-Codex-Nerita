<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import ToolCard from "../../../src/chat/tools/ToolCard.svelte";
	import { useFollowConversation } from "../../../src/chat/messages/useFollowConversation.svelte";
	import "../../../src/chat/chat.css";
	let container = $state<HTMLDivElement | null>(null);
	useFollowConversation(
		() => container,
		() => "tool-scroll",
		() => false,
	);
</script>

<div bind:this={container} class="h-[400px] overflow-y-auto px-5 py-4">
	<div class="h-[480px]">過去の会話</div>
	{#each Array.from({ length: 6 }) as _, index (index)}<ToolCard
			tool={{
				id: `scroll-${index}`,
				title: `スクロール確認 ${index + 1}`,
				kind: index === 1 ? "think" : "execute",
				status: "completed",
				paths: [],
				...(index === 1
					? {
							content: [
								{
									type: "content",
									content: {
										type: "text",
										text: "推論の内容\n".repeat(40),
									},
								},
							],
						}
					: {
							output: {
								preview: "実行結果\n".repeat(40),
								truncated: false,
							},
						}),
			}}
		></ToolCard>{/each}
</div>
